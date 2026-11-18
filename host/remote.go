package main

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const extensionOrigin = "chrome-extension://dnmkapgfepfbfeeecepaebdgkpolcmik"
const passwordIterations = 600000
const dailyRequests = 200

type remoteUser struct {
	Salt     string
	Hash     string
	Disabled bool
}
type userDB map[string]remoteUser
type remoteSession struct {
	User, Fingerprint string
	Expires           time.Time
}
type attempts struct {
	Count int
	Until time.Time
}
type usage struct {
	Day   string
	Count int
}
type remoteJob struct {
	User     string
	Expires  time.Time
	Done     bool
	Lines    []string
	Error    string
	ServerMs int64
	Cancel   context.CancelFunc
}
type remoteServer struct {
	jobs           map[string]*remoteJob
	dir            string
	mu             sync.Mutex
	sessions       map[string]remoteSession
	attempts       map[string]attempts
	globalAttempts attempts
	active         map[string]bool
	usage          map[string]usage
	slots          chan struct{}
	translate      func(context.Context, []byte) (captions, error)
}

func dataDir() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "korean-dubber-server"), nil
}
func loadUsers(dir string) (userDB, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "users.json"))
	if os.IsNotExist(err) {
		return userDB{}, nil
	}
	if err != nil {
		return nil, err
	}
	var users userDB
	err = json.Unmarshal(raw, &users)
	if users == nil {
		users = userDB{}
	}
	return users, err
}
func randomString() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(s string) string        { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func normalizeUser(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
func manageUser(args []string) error {
	dir, err := dataDir()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	users, err := loadUsers(dir)
	if err != nil {
		return err
	}
	if len(args) == 1 && args[0] == "list" {
		for email, u := range users {
			fmt.Printf("%s\tdisabled=%t\n", email, u.Disabled)
		}
		return nil
	}
	if len(args) != 2 {
		return errors.New("사용법: host user add|revoke 이메일 / host user list (add 비밀번호는 표준입력으로 전달)")
	}
	email := normalizeUser(args[1])
	if len(email) > 254 || !strings.Contains(email, "@") || strings.ContainsAny(email, "\r\n\x00") {
		return errors.New("이메일을 확인하세요")
	}
	switch args[0] {
	case "add":
		raw, err := io.ReadAll(io.LimitReader(os.Stdin, 258))
		if err != nil {
			return err
		}
		password := strings.TrimRight(string(raw), "\r\n")
		if len(password) < 8 || len(password) > 256 {
			return errors.New("비밀번호는 8~256바이트여야 합니다")
		}
		salt := make([]byte, 32)
		if _, err = rand.Read(salt); err != nil {
			return err
		}
		key, err := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
		if err != nil {
			return err
		}
		users[email] = remoteUser{Salt: base64.StdEncoding.EncodeToString(salt), Hash: base64.StdEncoding.EncodeToString(key)}
	case "revoke":
		u, ok := users[email]
		if !ok {
			return errors.New("등록되지 않은 사용자입니다")
		}
		u.Disabled = true
		users[email] = u
	default:
		return errors.New("지원하지 않는 사용자 관리 명령입니다")
	}
	if err = writeJSON(filepath.Join(dir, "users.json"), users); err != nil {
		return err
	}
	fmt.Println("사용자 설정을 저장했습니다. 기존 세션은 다음 요청부터 새 설정을 따릅니다.")
	return nil
}
func newRemoteServer(dir string, translate func(context.Context, []byte) (captions, error)) (*remoteServer, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	s := &remoteServer{jobs: map[string]*remoteJob{}, dir: dir, sessions: map[string]remoteSession{}, attempts: map[string]attempts{}, active: map[string]bool{}, usage: map[string]usage{}, slots: make(chan struct{}, 2), translate: translate}
	raw, err := os.ReadFile(filepath.Join(dir, "usage.json"))
	if err == nil {
		if err = json.Unmarshal(raw, &s.usage); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	raw, err = os.ReadFile(filepath.Join(dir, "sessions.json"))
	if err == nil {
		if err = json.Unmarshal(raw, &s.sessions); err != nil {
			return nil, err
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	for id, session := range s.sessions {
		if time.Now().After(session.Expires) {
			delete(s.sessions, id)
		}
	}
	return s, nil
}
func replyJSON(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(value)
}
func apiError(w http.ResponseWriter, code int, message string) {
	replyJSON(w, code, map[string]string{"error": message})
}
func readBody(w http.ResponseWriter, r *http.Request, value any) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid JSON")
	}
	return nil
}
func (s *remoteServer) authAllowed(email string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if now.After(s.globalAttempts.Until) {
		s.globalAttempts = attempts{Until: now.Add(time.Minute)}
	}
	if s.globalAttempts.Count >= 30 {
		return false
	}
	s.globalAttempts.Count++
	for k, a := range s.attempts {
		if now.After(a.Until) {
			delete(s.attempts, k)
		}
	}
	a := s.attempts[email]
	if a.Count == 0 {
		a.Until = now.Add(time.Minute)
	}
	if a.Count >= 5 {
		return false
	}
	a.Count++
	s.attempts[email] = a
	return true
}
func (s *remoteServer) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if readBody(w, r, &body) != nil || len(body.Email) > 254 || len(body.Password) > 256 {
		apiError(w, 400, "로그인 입력을 확인하세요.")
		return
	}
	email := normalizeUser(body.Email)
	if !s.authAllowed(email) {
		w.Header().Set("Retry-After", "60")
		apiError(w, 429, "로그인 요청이 많습니다. 1분 뒤 다시 시도하세요.")
		return
	}
	users, err := loadUsers(s.dir)
	if err != nil {
		apiError(w, 503, "사용자 정보를 읽지 못했습니다.")
		return
	}
	u, ok := users[email]
	// Derive a key for unknown accounts as well, avoiding a fast account-existence check.
	salt, _ := base64.StdEncoding.DecodeString(u.Salt)
	if len(salt) != 32 {
		salt = make([]byte, 32)
	}
	expected, _ := base64.StdEncoding.DecodeString(u.Hash)
	key, err := pbkdf2.Key(sha256.New, body.Password, salt, passwordIterations, 32)
	if err != nil || subtle.ConstantTimeCompare(key, expected) != 1 || !ok || u.Disabled {
		apiError(w, 401, "허용된 계정과 비밀번호를 확인하세요.")
		return
	}
	token := randomString()
	expires := time.Now().Add(14 * 24 * time.Hour)
	s.mu.Lock()
	for k, v := range s.sessions {
		if time.Now().After(v.Expires) || v.User == email {
			delete(s.sessions, k)
		}
	}
	if len(s.sessions) >= 1000 {
		s.mu.Unlock()
		apiError(w, 503, "로그인 세션이 가득 찼습니다.")
		return
	}
	s.sessions[digest(token)] = remoteSession{User: email, Fingerprint: u.Hash, Expires: expires}
	if err := writeJSON(filepath.Join(s.dir, "sessions.json"), s.sessions); err != nil {
		delete(s.sessions, digest(token))
		s.mu.Unlock()
		apiError(w, 503, "로그인을 저장하지 못했습니다.")
		return
	}
	s.mu.Unlock()
	replyJSON(w, 200, map[string]any{"token": token, "email": email, "expiresAt": expires.UnixMilli()})
}
func (s *remoteServer) authenticate(r *http.Request) (remoteSession, string, bool) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") || len(header) > 200 {
		return remoteSession{}, "", false
	}
	id := digest(strings.TrimPrefix(header, "Bearer "))
	s.mu.Lock()
	session, ok := s.sessions[id]
	s.mu.Unlock()
	if !ok || time.Now().After(session.Expires) {
		return session, id, false
	}
	users, err := loadUsers(s.dir)
	u, exists := users[session.User]
	if err != nil || !exists || u.Disabled || u.Hash != session.Fingerprint {
		return session, id, false
	}
	return session, id, true
}
func (s *remoteServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin != "" && origin != extensionOrigin {
		apiError(w, 403, "허용되지 않은 출처입니다.")
		return
	}
	if origin == extensionOrigin {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	}
	if r.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}
	if r.URL.Path == "/health" && r.Method == "GET" {
		replyJSON(w, 200, map[string]string{"status": "ok", "model": "gpt-6.1-terra", "effort": "medium"})
		return
	}
	if r.URL.Path == "/v1/login" && r.Method == "POST" {
		s.login(w, r)
		return
	}
	if r.URL.Path != "/v1/session" && r.URL.Path != "/v1/logout" && r.URL.Path != "/v1/translate" && !strings.HasPrefix(r.URL.Path, "/v1/jobs/") {
		apiError(w, 404, "없는 경로입니다.")
		return
	}
	session, id, ok := s.authenticate(r)
	if !ok {
		apiError(w, 401, "로그인이 필요하거나 계정 접근이 해제되었습니다.")
		return
	}
	if strings.HasPrefix(r.URL.Path, "/v1/jobs/") {
		jobID := strings.TrimPrefix(r.URL.Path, "/v1/jobs/")
		s.mu.Lock()
		job, exists := s.jobs[jobID]
		if !exists || job.User != session.User || time.Now().After(job.Expires) {
			s.mu.Unlock()
			apiError(w, 404, "번역 작업이 없거나 만료되었습니다.")
			return
		}
		if r.Method == "DELETE" {
			job.Cancel()
			delete(s.jobs, jobID)
			s.mu.Unlock()
			replyJSON(w, 200, map[string]bool{"ok": true})
			return
		}
		if r.Method != "GET" {
			s.mu.Unlock()
			apiError(w, 405, "허용하지 않는 요청입니다.")
			return
		}
		result := map[string]any{"done": job.Done, "lines": job.Lines, "serverMs": job.ServerMs}
		if job.Error != "" {
			result["error"] = job.Error
		}
		s.mu.Unlock()
		replyJSON(w, 200, result)
		return
	}
	if r.URL.Path == "/v1/session" && r.Method == "GET" {
		replyJSON(w, 200, map[string]any{"email": session.User, "expiresAt": session.Expires.UnixMilli()})
		return
	}
	if r.URL.Path == "/v1/logout" && r.Method == "POST" {
		s.mu.Lock()
		delete(s.sessions, id)
		err := writeJSON(filepath.Join(s.dir, "sessions.json"), s.sessions)
		s.mu.Unlock()
		if err != nil {
			apiError(w, 503, "서버의 로그아웃 기록 저장에 실패했습니다.")
			return
		}
		replyJSON(w, 200, map[string]bool{"ok": true})
		return
	}
	if r.URL.Path != "/v1/translate" || r.Method != "POST" {
		apiError(w, 405, "허용하지 않는 요청입니다.")
		return
	}
	var body struct {
		Lines []string `json:"lines"`
		Async bool     `json:"async,omitempty"`
	}
	if readBody(w, r, &body) != nil {
		apiError(w, 400, "자막 요청을 확인하세요.")
		return
	}
	data, _ := json.Marshal(captions{Lines: body.Lines})
	if _, err := parse(data, 24, 1200); err != nil {
		apiError(w, 400, err.Error())
		return
	}
	s.mu.Lock()
	if s.active[session.User] {
		s.mu.Unlock()
		w.Header().Set("Retry-After", "5")
		apiError(w, 429, "이 계정의 번역이 이미 진행 중입니다.")
		return
	}
	day := time.Now().UTC().Format("2006-01-02")
	used := s.usage[session.User]
	if used.Day != day {
		used = usage{Day: day}
	}
	if used.Count >= dailyRequests {
		s.mu.Unlock()
		apiError(w, 429, "오늘의 번역 요청 한도에 도달했습니다.")
		return
	}
	select {
	case s.slots <- struct{}{}:
	default:
		s.mu.Unlock()
		w.Header().Set("Retry-After", "5")
		apiError(w, 429, "사무실 번역 서버가 사용 중입니다. 잠시 뒤 다시 시작하세요.")
		return
	}
	used.Count++
	s.usage[session.User] = used
	if err := writeJSON(filepath.Join(s.dir, "usage.json"), s.usage); err != nil {
		<-s.slots
		s.mu.Unlock()
		apiError(w, 503, "사용량을 기록하지 못했습니다.")
		return
	}
	s.active[session.User] = true
	s.mu.Unlock()
	release := func() { s.mu.Lock(); delete(s.active, session.User); s.mu.Unlock(); <-s.slots }
	if body.Async {
		jobID := randomString()
		ctx, cancel := context.WithTimeout(context.Background(), 125*time.Second)
		job := &remoteJob{User: session.User, Expires: time.Now().Add(5 * time.Minute), Cancel: cancel}
		s.mu.Lock()
		for key, old := range s.jobs {
			if time.Now().After(old.Expires) {
				old.Cancel()
				delete(s.jobs, key)
			}
		}
		s.jobs[jobID] = job
		s.mu.Unlock()
		go func() {
			defer release()
			defer cancel()
			started := time.Now()
			result, err := s.translate(ctx, data)
			s.mu.Lock()
			defer s.mu.Unlock()
			job.Done = true
			job.ServerMs = time.Since(started).Milliseconds()
			job.Expires = time.Now().Add(2 * time.Minute)
			if err != nil {
				job.Error = "사무실 Codex 번역에 실패했습니다."
			} else {
				job.Lines = result.Lines
			}
		}()
		replyJSON(w, 202, map[string]string{"jobId": jobID})
		return
	}
	defer release()
	started := time.Now()
	result, err := s.translate(r.Context(), data)
	if err != nil {
		apiError(w, 502, "사무실 Codex 번역에 실패했습니다.")
		return
	}
	replyJSON(w, 200, map[string]any{"lines": result.Lines, "serverMs": time.Since(started).Milliseconds()})
}

func runServer(nativeDir string) error {
	dir, err := dataDir()
	if err != nil {
		return err
	}
	s, err := newRemoteServer(dir, func(ctx context.Context, data []byte) (captions, error) {
		return translateContext(ctx, nativeDir, data)
	})
	if err != nil {
		return err
	}
	server := &http.Server{Addr: "127.0.0.1:8765", Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 135 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	fmt.Fprintln(os.Stderr, "Korean dubber authenticated server: 127.0.0.1:8765")
	return server.ListenAndServe()
}

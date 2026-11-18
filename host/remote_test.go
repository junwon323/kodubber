package main

import (
	"context"
	"crypto/pbkdf2"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setupRemote(t *testing.T) (*remoteServer, string, *int) {
	t.Helper()
	dir := t.TempDir()
	salt := []byte(strings.Repeat("s", 32))
	key, _ := pbkdf2.Key(sha256.New, "test-password-only", salt, passwordIterations, 32)
	err := writeJSON(filepath.Join(dir, "users.json"), userDB{"allowed@example.test": {Salt: base64.StdEncoding.EncodeToString(salt), Hash: base64.StdEncoding.EncodeToString(key)}})
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	s, err := newRemoteServer(dir, func(ctx context.Context, data []byte) (captions, error) {
		count++
		return captions{Lines: []string{"한국어 번역"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return s, dir, &count
}
func request(s *remoteServer, method, path, token, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func loginTest(t *testing.T, s *remoteServer) string {
	t.Helper()
	w := request(s, "POST", "/v1/login", "", `{"email":"allowed@example.test","password":"test-password-only"}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var b struct {
		Token     string
		ExpiresAt int64
	}
	json.Unmarshal(w.Body.Bytes(), &b)
	if time.Until(time.UnixMilli(b.ExpiresAt)) < 13*24*time.Hour {
		t.Fatal("session not two weeks")
	}
	return b.Token
}
func TestRemoteAccessAndPersistence(t *testing.T) {
	s, dir, count := setupRemote(t)
	if request(s, "POST", "/v1/translate", "", `{"lines":["Hi"]}`).Code != 401 {
		t.Fatal("anonymous access")
	}
	if request(s, "POST", "/v1/login", "", `{"email":"uninvited@example.test","password":"test-password-only"}`).Code != 401 {
		t.Fatal("unapproved user")
	}
	if request(s, "POST", "/v1/login", "", `{"email":"allowed@example.test","password":"wrong"}`).Code != 401 {
		t.Fatal("wrong password")
	}
	token := loginTest(t, s)
	if request(s, "POST", "/v1/translate", token, `{"lines":["Hi"]}`).Code != 200 || *count != 1 {
		t.Fatal("translation failed")
	}
	if request(s, "POST", "/v1/translate", token, `{"lines":["Hi"],"command":"anything"}`).Code != 400 || *count != 1 {
		t.Fatal("extra commands accepted")
	}
	r := httptest.NewRequest("POST", "/v1/translate", strings.NewReader(`{"lines":["Hi"]}`))
	r.Header.Set("Origin", "https://evil.example")
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("untrusted origin")
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "sessions.json"))
	if strings.Contains(string(raw), token) {
		t.Fatal("plaintext bearer persisted")
	}
	restarted, err := newRemoteServer(dir, s.translate)
	if err != nil {
		t.Fatal(err)
	}
	if request(restarted, "GET", "/v1/session", token, "").Code != 200 {
		t.Fatal("session lost on restart")
	}
	if request(restarted, "POST", "/v1/logout", token, `{}`).Code != 200 {
		t.Fatal("logout")
	}
	again, _ := newRemoteServer(dir, s.translate)
	if request(again, "GET", "/v1/session", token, "").Code != 401 {
		t.Fatal("logout not durable")
	}
}
func TestRevocationExpiryAndQuota(t *testing.T) {
	s, dir, count := setupRemote(t)
	token := loginTest(t, s)
	s.usage["allowed@example.test"] = usage{Day: time.Now().UTC().Format("2006-01-02"), Count: dailyRequests}
	if request(s, "POST", "/v1/translate", token, `{"lines":["Hi"]}`).Code != 429 || *count != 0 {
		t.Fatal("quota")
	}
	users, _ := loadUsers(dir)
	u := users["allowed@example.test"]
	u.Disabled = true
	users["allowed@example.test"] = u
	writeJSON(filepath.Join(dir, "users.json"), users)
	if request(s, "GET", "/v1/session", token, "").Code != 401 {
		t.Fatal("revoke failed")
	}
	u.Disabled = false
	users["allowed@example.test"] = u
	writeJSON(filepath.Join(dir, "users.json"), users)
	expired := s.sessions[digest(token)]
	expired.Expires = time.Now().Add(-time.Minute)
	s.sessions[digest(token)] = expired
	if request(s, "GET", "/v1/session", token, "").Code != 401 {
		t.Fatal("expired allowed")
	}
}
func TestLoginRateAndConcurrentAdmission(t *testing.T) {
	s, _, count := setupRemote(t)
	for i := 0; i < 5; i++ {
		request(s, "POST", "/v1/login", "", `{"email":"nobody@example.test","password":"wrong"}`)
	}
	if request(s, "POST", "/v1/login", "", `{"email":"nobody@example.test","password":"wrong"}`).Code != 429 {
		t.Fatal("no throttle")
	}
	token := loginTest(t, s)
	s.active["allowed@example.test"] = 3
	if request(s, "POST", "/v1/translate", token, `{"lines":["Hi"]}`).Code != 429 || *count != 0 {
		t.Fatal("parallel request accepted")
	}
}
func TestAsyncJobPollingAndCancellation(t *testing.T) {
	s, _, _ := setupRemote(t)
	token := loginTest(t, s)
	started := make(chan struct{})
	ended := make(chan struct{})
	s.translate = func(ctx context.Context, data []byte) (captions, error) {
		close(started)
		<-ctx.Done()
		close(ended)
		return captions{}, ctx.Err()
	}
	w := request(s, "POST", "/v1/translate", token, `{"lines":["Hi"],"async":true}`)
	if w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	var body map[string]string
	json.Unmarshal(w.Body.Bytes(), &body)
	job := body["jobId"]
	if job == "" {
		t.Fatal("no job")
	}
	<-started
	if request(s, "GET", "/v1/jobs/"+job, "", "").Code != 401 {
		t.Fatal("unauthorized polling")
	}
	if request(s, "GET", "/v1/jobs/"+job, token, "").Code != 200 {
		t.Fatal("poll failed")
	}
	if request(s, "DELETE", "/v1/jobs/"+job, token, "").Code != 200 {
		t.Fatal("cancel failed")
	}
	select {
	case <-ended:
	case <-time.After(time.Second):
		t.Fatal("translator did not cancel")
	}
}

func TestMultipleDeviceSessionsAndThreeConcurrentJobs(t *testing.T) {
	s, dir, _ := setupRemote(t)
	tokens := []string{loginTest(t, s), loginTest(t, s), loginTest(t, s)}
	restarted, err := newRemoteServer(dir, s.translate)
	if err != nil {
		t.Fatal(err)
	}
	for _, token := range tokens {
		if request(restarted, "GET", "/v1/session", token, "").Code != 200 {
			t.Fatal("device session invalidated by later login or restart")
		}
	}
	s = restarted
	started := make(chan struct{}, 4)
	finish := make(chan struct{})
	defer close(finish)
	s.translate = func(ctx context.Context, data []byte) (captions, error) {
		started <- struct{}{}
		select {
		case <-finish:
			return captions{Lines: []string{"완료"}}, nil
		case <-ctx.Done():
			return captions{}, ctx.Err()
		}
	}
	jobs := []string{}
	for _, token := range tokens {
		w := request(s, "POST", "/v1/translate", token, `{"lines":["Hi"],"async":true}`)
		if w.Code != 202 {
			t.Fatal("one of three devices rejected", w.Code, w.Body.String())
		}
		var body map[string]string
		json.Unmarshal(w.Body.Bytes(), &body)
		jobs = append(jobs, body["jobId"])
	}
	for range tokens {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("three jobs not running together")
		}
	}
	if request(s, "POST", "/v1/translate", tokens[0], `{"lines":["Fourth"],"async":true}`).Code != 429 {
		t.Fatal("fourth request admitted")
	}
	if request(s, "DELETE", "/v1/jobs/"+jobs[0], tokens[0], "").Code != 200 {
		t.Fatal("cancel")
	}
	deadline := time.Now().Add(time.Second)
	for {
		s.mu.Lock()
		active := s.active["allowed@example.test"]
		s.mu.Unlock()
		if active == 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("slot not released")
		}
		time.Sleep(time.Millisecond)
	}
	if request(s, "POST", "/v1/translate", tokens[0], `{"lines":["Replacement"],"async":true}`).Code != 202 {
		t.Fatal("released slot cannot be reused")
	}
	if request(s, "POST", "/v1/logout", tokens[0], `{}`).Code != 200 {
		t.Fatal("logout")
	}
	if request(s, "GET", "/v1/session", tokens[0], "").Code != 401 {
		t.Fatal("logged out device still accepted")
	}
	for _, token := range tokens[1:] {
		if request(s, "GET", "/v1/session", token, "").Code != 200 {
			t.Fatal("logout affected another device")
		}
	}
}

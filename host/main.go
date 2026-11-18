// The same standalone binary registers itself and serves Chrome native messages.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"
)

const name = "com.codex.korean_dubber"
const limit = 65536
const schema = `{"type":"object","properties":{"lines":{"type":"array","items":{"type":"string"}}},"required":["lines"],"additionalProperties":false}`

//go:embed translation-prompt.txt
var translationPrompt string

type config struct {
	Codex      string
	Path       string
	Entrypoint string `json:",omitempty"`
}
type captions struct {
	Lines []string `json:"lines"`
	Style string   `json:"style,omitempty"`
}

func registerDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "windows" {
		root, err := os.UserCacheDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(root, "KoreanDubber", "NativeMessagingHosts"), nil
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts"), nil
	}
	root := os.Getenv("XDG_CONFIG_HOME")
	if root == "" {
		root = filepath.Join(home, ".config")
	}
	return filepath.Join(root, "google-chrome/NativeMessagingHosts"), nil
}
func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".dub-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	_, err = tmp.Write(data)
	closeErr := tmp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp.Name(), path)
}
func install(dir string) error {
	codex, err := exec.LookPath("codex")
	if err != nil {
		return errors.New("Codex CLI를 찾지 못했습니다. codex 명령을 사용할 수 있는 터미널에서 다시 실행하세요.")
	}
	codex, err = filepath.Abs(codex)
	if err != nil {
		return err
	}
	cfg := config{Codex: codex, Path: os.Getenv("PATH")}
	if runtime.GOOS == "windows" && !strings.EqualFold(filepath.Ext(codex), ".exe") {
		// Global npm installations expose a .cmd shim alongside node_modules.
		cfg.Entrypoint = filepath.Join(filepath.Dir(codex), "node_modules", "@openai", "codex", "bin", "codex.js")
		node, err := exec.LookPath("node.exe")
		if err != nil {
			return errors.New("npm으로 설치한 Codex의 node.exe를 찾을 수 없습니다.")
		}
		if _, err := os.Stat(cfg.Entrypoint); err != nil {
			return errors.New("Windows용 codex.exe 또는 npm 전역 Codex 설치를 확인하세요.")
		}
		cfg.Codex, err = filepath.Abs(node)
		if err != nil {
			return err
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	ext := filepath.Join(filepath.Dir(filepath.Dir(exe)), "extension")
	raw, err := os.ReadFile(filepath.Join(ext, "manifest.json"))
	if err != nil {
		return err
	}
	var manifest struct{ Key string }
	if err = json.Unmarshal(raw, &manifest); err != nil {
		return err
	}
	key, err := base64.StdEncoding.DecodeString(manifest.Key)
	if err != nil || len(key) == 0 {
		return errors.New("확장 공개 키를 읽지 못했습니다.")
	}
	digest := sha256.Sum256(key)
	id := ""
	for _, b := range digest[:16] {
		id += string([]byte{'a' + (b >> 4), 'a' + (b & 15)})
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if err = writeJSON(filepath.Join(dir, name+".config"), cfg); err != nil {
		return err
	}
	host := map[string]any{"name": name, "description": "Korean lecture caption translator", "type": "stdio", "path": exe, "allowed_origins": []string{"chrome-extension://" + id + "/"}}
	if err = writeJSON(filepath.Join(dir, name+".json"), host); err != nil {
		return err
	}
	if runtime.GOOS == "windows" {
		reg := filepath.Join(os.Getenv("SystemRoot"), "System32", "reg.exe")
		key := `HKCU\Software\Google\Chrome\NativeMessagingHosts\` + name
		cmd := exec.Command(reg, "add", key, "/ve", "/t", "REG_SZ", "/d", filepath.Join(dir, name+".json"), "/f")
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("Chrome 등록 실패: %w (%s)", err, out)
		}
	}
	fmt.Printf("설치 완료. Chrome에서 chrome://extensions 를 여세요.\n개발자 모드 → 압축해제된 확장 프로그램을 로드 → 다음 폴더 선택\n%s\n", ext)
	return nil
}
func parse(data []byte, maxLines, maxChars int) (captions, error) {
	var c captions
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil || dec.Decode(new(any)) != io.EOF || len(c.Lines) == 0 || len(c.Lines) > maxLines {
		return c, errors.New("자막 데이터 형식을 확인하세요.")
	}
	for _, s := range c.Lines {
		if strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > maxChars {
			return c, errors.New("자막 길이를 확인하세요.")
		}
	}
	return c, nil
}
func translate(dir string, data []byte) (captions, error) {
	return translateContext(context.Background(), dir, data)
}
func translateContext(parent context.Context, dir string, data []byte) (captions, error) {
	c, err := parse(data, 24, 1200)
	if err != nil {
		return c, err
	}
	// Legacy style values now use the selected teacher tone as well.
	switch c.Style {
	case "", "lecture", "friendly", "concise":
	default:
		return c, errors.New("지원하지 않는 번역 스타일입니다.")
	}
	raw, err := os.ReadFile(filepath.Join(dir, name+".config"))
	if err != nil {
		return c, errors.New("운영체제에 맞는 설치 파일을 다시 실행하세요.")
	}
	var cfg config
	if err = json.Unmarshal(raw, &cfg); err != nil || !filepath.IsAbs(cfg.Codex) {
		return c, errors.New("설치 정보를 읽지 못했습니다.")
	}
	tmp, err := os.MkdirTemp("", "korean-dubber-*")
	if err != nil {
		return c, err
	}
	defer os.RemoveAll(tmp)
	if err = os.WriteFile(filepath.Join(tmp, "schema"), []byte(schema), 0600); err != nil {
		return c, err
	}
	ctx, cancel := context.WithTimeout(parent, 120*time.Second)
	defer cancel()
	args := []string{"exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only", "--disable", "shell_tool", "--disable", "apps", "--disable", "plugins", "--disable", "hooks", "-c", `web_search="disabled"`, "--model", "gpt-6.1-terra", "-c", `model_reasoning_effort="medium"`, "--output-schema", "schema", "-o", "result", "-"}
	if cfg.Entrypoint != "" {
		args = append([]string{cfg.Entrypoint}, args...)
	}
	cmd := exec.CommandContext(ctx, cfg.Codex, args...)
	lines, _ := json.Marshal(c.Lines)
	cmd.Dir = tmp
	cmd.Env = append(os.Environ(), "PATH="+cfg.Path)
	cmd.Stdin = io.MultiReader(strings.NewReader(translationPrompt+"\n"), bytes.NewReader(lines))
	if err = cmd.Run(); err != nil {
		return c, errors.New("Codex 번역 실패. 로그인, 네트워크 및 CLI 버전을 확인하세요.")
	}
	file, err := os.Open(filepath.Join(tmp, "result"))
	if err != nil {
		return c, err
	}
	defer file.Close()
	raw, err = io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || len(raw) > limit {
		return c, errors.New("번역 결과를 읽지 못했습니다.")
	}
	result, err := parse(raw, len(c.Lines), 2400)
	if err != nil || result.Style != "" || len(result.Lines) != len(c.Lines) {
		return c, errors.New("번역 결과가 자막 구간과 일치하지 않습니다.")
	}
	return result, nil
}
func serve(dir string) error {
	var size uint32
	if err := binary.Read(os.Stdin, binary.NativeEndian, &size); err != nil {
		return err
	}
	var result any
	var err error
	if size == 0 || size > limit {
		err = errors.New("자막 요청 크기를 확인하세요.")
	} else {
		data := make([]byte, size)
		if _, err = io.ReadFull(os.Stdin, data); err == nil {
			result, err = translate(dir, data)
		}
	}
	if err != nil {
		result = map[string]string{"error": err.Error()}
	}
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if err = binary.Write(os.Stdout, binary.NativeEndian, uint32(len(data))); err != nil {
		return err
	}
	_, err = os.Stdout.Write(data)
	return err
}
func main() {
	dir, err := registerDir()
	if err == nil {
		if len(os.Args) > 1 && os.Args[1] == "server" {
			err = runServer(dir)
		} else if len(os.Args) > 1 && os.Args[1] == "user" {
			err = manageUser(os.Args[2:])
		} else if len(os.Args) == 2 && os.Args[1] == "install" {
			err = install(dir)
		} else {
			err = serve(dir)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

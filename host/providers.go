package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"
)

type engine struct {
	id, name, executable, npmPackage string
}

var engines = []engine{
	{"codex", "Codex", "codex", "@openai/codex"},
	{"claude", "Claude Code", "claude", "@anthropic-ai/claude-code"},
	{"antigravity", "Antigravity CLI", "agy", ""},
}

type executable struct {
	path, entrypoint string
}

func executableFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() &&
		(runtime.GOOS == "windows" || info.Mode().Perm()&0111 != 0)
}

func searchPaths(cfg config) []string {
	paths := filepath.SplitList(cfg.Path)
	paths = append(paths, filepath.SplitList(os.Getenv("PATH"))...)
	if home, err := os.UserHomeDir(); err == nil {
		for _, rel := range []string{".local/bin", "bin", ".volta/bin", ".npm-global/bin"} {
			paths = append(paths, filepath.Join(home, rel))
		}
		nvm, _ := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin"))
		slices.Reverse(nvm)
		paths = append(paths, nvm...)
	}
	if runtime.GOOS == "windows" {
		for _, item := range []struct{ env, rel string }{
			{"APPDATA", "npm"}, {"LOCALAPPDATA", "agy/bin"},
			{"LOCALAPPDATA", "Programs/nodejs"}, {"ProgramFiles", "nodejs"},
			{"ProgramFiles", "Google/antigravity-cli"},
		} {
			if base := os.Getenv(item.env); filepath.IsAbs(base) {
				paths = append(paths, filepath.Join(base, item.rel))
			}
		}
	} else {
		paths = append(paths, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin")
	}
	// Ignore relative PATH entries, including the current directory.
	return slices.DeleteFunc(paths, func(path string) bool { return !filepath.IsAbs(path) })
}

func locate(e engine, cfg config, paths []string) executable {
	// Earlier installers recorded an absolute Codex executable or Node plus its entry point.
	if e.id == "codex" && filepath.IsAbs(cfg.Codex) && executableFile(cfg.Codex) &&
		(cfg.Entrypoint == "" || (filepath.IsAbs(cfg.Entrypoint) && executableFile(cfg.Entrypoint))) {
		return executable{cfg.Codex, cfg.Entrypoint}
	}
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	for _, dir := range paths {
		native := filepath.Join(dir, e.executable+suffix)
		if executableFile(native) {
			return executable{path: native}
		}
		if runtime.GOOS == "windows" && e.npmPackage != "" && executableFile(filepath.Join(dir, e.executable+".cmd")) {
			if command := npmExecutable(e, dir, paths); command.path != "" {
				return command
			}
		}
	}
	return executable{}
}

func npmExecutable(e engine, shimDir string, paths []string) executable {
	// Resolve known npm packages through Node without executing a .cmd or invoking a shell.
	pkg := filepath.Join(shimDir, "node_modules", filepath.FromSlash(e.npmPackage))
	raw, err := os.ReadFile(filepath.Join(pkg, "package.json"))
	if err != nil {
		return executable{}
	}
	var manifest struct{ Bin json.RawMessage }
	if json.Unmarshal(raw, &manifest) != nil {
		return executable{}
	}
	var entry string
	if json.Unmarshal(manifest.Bin, &entry) != nil {
		var entries map[string]string
		if json.Unmarshal(manifest.Bin, &entries) != nil {
			return executable{}
		}
		entry = entries[e.executable]
	}
	if entry == "" || !filepath.IsLocal(filepath.FromSlash(entry)) {
		return executable{}
	}
	script := filepath.Join(pkg, filepath.FromSlash(entry))
	if !executableFile(script) {
		return executable{}
	}
	for _, dir := range append([]string{shimDir}, paths...) {
		node := filepath.Join(dir, "node.exe")
		if executableFile(node) {
			return executable{node, script}
		}
	}
	return executable{}
}

func handleMessage(dir string, data []byte) (any, error) {
	var cfg config
	raw, err := os.ReadFile(filepath.Join(dir, name+".config"))
	if err != nil || json.Unmarshal(raw, &cfg) != nil {
		return nil, errors.New("로컬 연결 파일을 다시 실행해 주세요.")
	}
	paths := searchPaths(cfg)
	var info struct {
		Action string `json:"action"`
	}
	if json.Unmarshal(data, &info) == nil && info.Action == "providers" {
		available := []string{}
		for _, e := range engines {
			if locate(e, cfg, paths).path != "" {
				available = append(available, e.id)
			}
		}
		return map[string][]string{"providers": available}, nil
	}
	return translate(data, cfg, paths, dir)
}

func translate(data []byte, cfg config, paths []string, configDir string) (captions, error) {
	c, err := parse(data, 24, 1200)
	if err != nil {
		return c, err
	}
	switch c.Style {
	case "", "lecture", "friendly", "concise":
	default:
		return c, errors.New("지원하지 않는 번역 스타일입니다.")
	}
	if c.Provider == "" {
		c.Provider = "codex"
	}
	for _, e := range engines {
		if e.id != c.Provider {
			continue
		}
		command := locate(e, cfg, paths)
		if command.path == "" {
			return c, fmt.Errorf("%s CLI를 찾지 못했습니다. 설치 후 확장을 다시 열어 주세요.", e.name)
		}
		raw, err := runTranslation(e, command, paths, c.Lines, configDir)
		if err != nil {
			return c, err
		}
		result, err := parse(raw, len(c.Lines), 2400)
		if err != nil || result.Style != "" || result.Provider != "" || len(result.Lines) != len(c.Lines) {
			return c, errors.New("번역 결과가 자막 구간과 일치하지 않습니다.")
		}
		return result, nil
	}
	return c, errors.New("지원하지 않는 번역 엔진입니다.")
}

// Deny agent tools within this request while keeping the user's existing CLI login.
const agySettings = `{"agentMode":"plan","toolPermission":"request-review","allowNonWorkspaceAccess":false,"permissions":{"deny":["command(*)","read_file(*)","write_file(*)","read_url(*)","execute_url(*)","download_url(*)","mcp(*)","mcp(*/*)","task(*)"]}}`

func runTranslation(e engine, command executable, paths []string, lines []string, configDir string) ([]byte, error) {
	tmp, err := os.MkdirTemp("", "korean-dubber-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	model, err := modelFor(e, command, paths, tmp, configDir)
	if err != nil {
		return nil, err
	}
	input, _ := json.Marshal(lines)
	prompt := translationPrompt + "\n출력 형식은 lines 키를 가진 JSON 객체입니다. 각 문자열에는 해당 구간의 한국어 대사만 넣으세요.\n" + string(input)
	var args []string
	switch e.id {
	case "codex":
		if err = os.WriteFile(filepath.Join(tmp, "schema"), []byte(schema), 0600); err != nil {
			return nil, err
		}
		args = []string{"exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--sandbox", "read-only", "--disable", "shell_tool", "--disable", "apps", "--disable", "plugins", "--disable", "hooks", "-c", `web_search="disabled"`, "--model", model, "-c", `model_reasoning_effort="medium"`, "--output-schema", "schema", "-o", "result", "-"}
	case "claude":
		args = []string{"-p", "--model", model, "--effort", "medium", "--output-format", "json", "--json-schema", schema, "--tools", "", "--safe-mode",
			"--strict-mcp-config", "--mcp-config", `{"mcpServers":{}}`, "--permission-mode", "dontAsk",
			"--settings", `{"disableAllHooks":true}`, "--no-session-persistence"}
	case "antigravity":
		args = []string{"--model", model, "--effort", "medium", "--input-format", "stream-json", "--output-format", "stream-json", "--json-schema", schema,
			"--settings", agySettings, "--mode", "plan", "--disable-slash-commands", "--print-timeout", "110s"}
		line, _ := json.Marshal(map[string]any{"event": "user", "message": map[string]string{"content": prompt}})
		prompt = string(line) + "\n"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	cmd := newCommand(ctx, command, paths, tmp, args...)
	cmd.Stdin = strings.NewReader(prompt)
	var raw []byte
	if e.id == "codex" {
		err = cmd.Run()
		if err == nil {
			var file *os.File
			file, err = os.Open(filepath.Join(tmp, "result"))
			if err == nil {
				defer file.Close()
				raw, err = io.ReadAll(io.LimitReader(file, limit+1))
			}
		}
	} else {
		raw, err = readOutput(ctx, cmd)
	}
	if err != nil {
		return nil, fmt.Errorf("%s 번역 실패. CLI의 로그인, 네트워크 및 버전을 확인하세요.", e.name)
	}
	switch e.id {
	case "claude":
		var reply struct {
			IsError    bool            `json:"is_error"`
			Structured json.RawMessage `json:"structured_output"`
		}
		if json.Unmarshal(raw, &reply) != nil || reply.IsError || len(reply.Structured) == 0 {
			return nil, errors.New("Claude Code 번역 실패. CLI 로그인과 사용량 한도를 확인하세요.")
		}
		raw = reply.Structured
	case "antigravity":
		raw, err = antigravityResponse(raw, len(lines))
		if err != nil {
			return nil, err
		}
	}
	if len(raw) == 0 || len(raw) > limit {
		return nil, errors.New("번역 결과 크기가 올바르지 않습니다.")
	}
	return raw, nil
}

func newCommand(ctx context.Context, command executable, paths []string, dir string, args ...string) *exec.Cmd {
	if command.entrypoint != "" {
		args = append([]string{command.entrypoint}, args...)
	}
	cmd := exec.CommandContext(ctx, command.path, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "PATH="+strings.Join(paths, string(os.PathListSeparator)))
	return cmd
}

func readOutput(ctx context.Context, cmd *exec.Cmd) ([]byte, error) {
	const maxOutput = 1 << 20
	// A CLI may return metadata along with captions. Bound it and still reap the process.
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		return nil, err
	}
	stop := context.AfterFunc(ctx, func() { _ = pipe.Close() })
	defer stop()
	raw, readErr := io.ReadAll(io.LimitReader(pipe, maxOutput+1))
	if readErr != nil || len(raw) > maxOutput {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return nil, errors.New("CLI 출력 제한을 초과했습니다.")
	}
	return raw, cmd.Wait()
}

func antigravityResponse(raw []byte, count int) ([]byte, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	for {
		var event struct {
			Event  string
			Result struct {
				Status, Response string
				Structured       json.RawMessage `json:"structured_output"`
			}
		}
		if err := decoder.Decode(&event); err != nil {
			break
		}
		if event.Event == "result" && event.Result.Status == "SUCCESS" {
			structured := event.Result.Structured
			if len(structured) == 0 || bytes.Equal(structured, []byte("null")) {
				return []byte(event.Result.Response), nil
			}
			// Some Hydrogen releases put a serialized caption array in one string.
			var result captions
			if json.Unmarshal(structured, &result) == nil && len(result.Lines) == 1 {
				var embedded []string
				if json.Unmarshal([]byte(result.Lines[0]), &embedded) == nil && len(embedded) == count {
					return json.Marshal(captions{Lines: embedded})
				}
			}
			return structured, nil
		}
	}
	return nil, errors.New("Antigravity 번역 실패. CLI 로그인과 사용량 한도를 확인하세요.")
}

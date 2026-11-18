package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

var terraModel = regexp.MustCompile(`^gpt-([0-9]+(?:\.[0-9]+)*)-terra$`)
var hydrogenModel = regexp.MustCompile(`^gemini-([0-9]+(?:\.[0-9]+)*)-hydrogen-medium$`)

func latestVersion(ids []string, family *regexp.Regexp) string {
	var best string
	var newest []int
	for _, id := range ids {
		match := family.FindStringSubmatch(id)
		if match == nil {
			continue
		}
		parts := strings.Split(match[1], ".")
		version := make([]int, len(parts))
		for i, part := range parts {
			version[i], _ = strconv.Atoi(part)
		}
		if best == "" || slices.Compare(version, newest) > 0 {
			best, newest = id, version
		}
	}
	return best
}

func modelFor(e engine, command executable, paths []string, workDir, configDir string) (string, error) {
	if e.id == "claude" {
		return "sonnet", nil
	}
	family := terraModel
	if e.id == "antigravity" {
		family = hydrogenModel
	}
	cacheFile := filepath.Join(configDir, name+"."+e.id+".model-cache")
	var cache struct {
		Command string
		Expires time.Time
		Model   string
	}
	if raw, err := os.ReadFile(cacheFile); err == nil && json.Unmarshal(raw, &cache) == nil &&
		cache.Command == command.path && time.Now().Before(cache.Expires) && family.MatchString(cache.Model) {
		return cache.Model, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var ids []string
	var err error
	if e.id == "codex" {
		ids, err = codexModels(ctx, newCommand(ctx, command, paths, workDir, "app-server", "--stdio",
			"--disable", "plugins", "--disable", "hooks", "--disable", "apps", "--disable", "shell_tool"))
	} else {
		var raw []byte
		raw, err = readOutput(ctx, newCommand(ctx, command, paths, workDir, "models"))
		for _, line := range strings.Split(string(raw), "\n") {
			if fields := strings.Fields(line); len(fields) > 0 {
				ids = append(ids, fields[0])
			}
		}
	}
	model := latestVersion(ids, family)
	if err != nil || model == "" {
		return "", fmt.Errorf("%s에서 medium 추론을 지원하는 번역 모델을 찾지 못했습니다. CLI 버전, 로그인 및 이용 가능한 모델을 확인하세요.", e.name)
	}
	cache.Command, cache.Model, cache.Expires = command.path, model, time.Now().Add(5*time.Minute)
	_ = writeJSON(cacheFile, cache)
	return model, nil
}

func codexModels(ctx context.Context, cmd *exec.Cmd) ([]string, error) {
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	defer func() { _ = input.Close(); _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	stop := context.AfterFunc(ctx, func() { _ = output.Close() })
	defer stop()
	send := json.NewEncoder(input).Encode
	if err := send(map[string]any{"id": 1, "method": "initialize", "params": map[string]any{
		"clientInfo": map[string]string{"name": "kodubber", "version": "0.14.0"},
	}}); err != nil {
		return nil, err
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	var models []string
	for scanner.Scan() {
		var reply struct {
			ID     int
			Error  json.RawMessage
			Result struct {
				NextCursor string `json:"nextCursor"`
				Data       []struct {
					Model                     string
					SupportedReasoningEfforts []struct{ ReasoningEffort string }
				}
			}
		}
		if json.Unmarshal(scanner.Bytes(), &reply) != nil || reply.ID == 0 {
			continue
		}
		if len(reply.Error) != 0 && string(reply.Error) != "null" {
			return nil, fmt.Errorf("Codex model catalog request failed")
		}
		if reply.ID == 1 {
			if err := send(map[string]any{"method": "initialized"}); err != nil {
				return nil, err
			}
		} else if reply.ID == 2 {
			for _, model := range reply.Result.Data {
				for _, effort := range model.SupportedReasoningEfforts {
					if effort.ReasoningEffort == "medium" {
						models = append(models, model.Model)
						break
					}
				}
			}
			if reply.Result.NextCursor == "" {
				return models, nil
			}
		}
		params := map[string]any{"limit": 100, "includeHidden": false}
		if reply.Result.NextCursor != "" {
			params["cursor"] = reply.Result.NextCursor
		}
		if err := send(map[string]any{"id": 2, "method": "model/list", "params": params}); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("Codex model catalog did not respond")
}

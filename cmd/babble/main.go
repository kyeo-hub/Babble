// babble —— Babble（Cloudflare 版 memos）CLI，Go 单文件零依赖版
// 支持 Windows / macOS / Linux。用法见 `babble help`。
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// 版本号由 CI 通过 -ldflags "-X main.version=..." 注入
var version = "dev"

// ---------- 配置 ----------

type Config struct {
	Server string `json:"server"`
	Token  string `json:"token"`
}

func configPath() string {
	if dir := os.Getenv("BABBLE_HOME"); dir != "" {
		return filepath.Join(dir, "config.json")
	}
	if runtime.GOOS == "windows" {
		if appdata := os.Getenv("APPDATA"); appdata != "" {
			return filepath.Join(appdata, "babble", "config.json")
		}
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".babble", "config.json")
	}
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "babble", "config.json")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "babble", "config.json")
}

func loadConfig() Config {
	cfg := Config{Server: "https://bb.kyeo.top"}
	if v := os.Getenv("BABBLE_SERVER"); v != "" {
		cfg.Server = v
	}
	if b, err := os.ReadFile(configPath()); err == nil {
		var saved Config
		if json.Unmarshal(b, &saved) == nil {
			if saved.Server != "" && os.Getenv("BABBLE_SERVER") == "" {
				cfg.Server = saved.Server
			}
			cfg.Token = saved.Token
		}
	}
	if v := os.Getenv("BABBLE_TOKEN"); v != "" {
		cfg.Token = v
	}
	return cfg
}

func saveConfig(cfg Config) {
	p := configPath()
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	b, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(p, b, 0o600); err != nil {
		fatal("保存配置失败：%v", err)
	}
}

// ---------- HTTP ----------

type apiError struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func apiCall(cfg Config, method, path string, body []byte, contentType string) []byte {
	url := strings.TrimRight(cfg.Server, "/") + "/api/v1" + path
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		fatal("构造请求失败：%v", err)
	}
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fatal("网络错误：无法连接 %s（%v）", cfg.Server, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		var ae apiError
		if json.Unmarshal(data, &ae) == nil && ae.Error.Message != "" {
			fatalf("API 错误（%d）：%s", resp.StatusCode, ae.Error.Message)
		}
		fatalf("API 错误（%d）：%s", resp.StatusCode, truncate(string(data), 200))
	}
	return data
}

// ---------- JSON helpers（保持字段顺序无关紧要，用 map 足够） ----------

func jget(data []byte, path ...string) any {
	var v any
	if json.Unmarshal(data, &v) != nil {
		return nil
	}
	for _, k := range path {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[k]
	}
	return v
}

func jstr(data []byte, path ...string) string {
	s, _ := jget(data, path...).(string)
	return s
}

func jnum(data []byte, path ...string) float64 {
	f, _ := jget(data, path...).(float64)
	return f
}

func jlist(data []byte, key string) []any {
	l, _ := jget(data, key).([]any)
	return l
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func fatal(format string, args ...any) {
	fatalf(format, args...)
}

// ---------- 子命令 ----------

func cmdLogin(cfg Config, args []string) {
	if len(args) != 2 {
		fatalf("用法：babble login <用户名> <密码>")
	}
	loginBody, _ := json.Marshal(map[string]string{"username": args[0], "password": args[1]})
	jwtRaw := apiCall(cfg, "POST", "/auth/login", loginBody, "application/json")
	jwtTok := jstr(jwtRaw, "accessToken")
	if jwtTok == "" {
		fatalf("登录失败：%s", truncate(string(jwtRaw), 200))
	}
	tokBody, _ := json.Marshal(map[string]string{"name": "cli-go"})
	tokRaw := apiCall(Config{Server: cfg.Server, Token: jwtTok}, "POST", "/auth/tokens", tokBody, "application/json")
	token := jstr(tokRaw, "token")
	if token == "" {
		token = jstr(tokRaw, "plainToken")
	}
	if token == "" {
		fatalf("签发 token 失败：%s", truncate(string(tokRaw), 200))
	}
	cfg.Token = token
	saveConfig(cfg)
	fmt.Printf("✅ 已登录 %s，token 已存 %s\n", cfg.Server, configPath())
}

func cmdServer(cfg Config, args []string) {
	if len(args) >= 1 {
		cfg.Server = args[0]
		saveConfig(cfg)
	}
	fmt.Println("服务器：", cfg.Server)
}

func cmdPost(cfg Config, args []string) {
	visibility := "PRIVATE"
	var rest []string
	for i := 0; i < len(args); i++ {
		if args[i] == "-v" || args[i] == "--visibility" {
			if i+1 < len(args) {
				visibility = args[i+1]
				i++
			}
		} else {
			rest = append(rest, args[i])
		}
	}
	text := strings.Join(rest, " ")
	if text == "" {
		b, _ := io.ReadAll(os.Stdin)
		text = string(b)
	}
	text = strings.TrimSpace(text)
	if text == "" {
		fatalf("内容为空")
	}
	body, _ := json.Marshal(map[string]string{"content": text, "visibility": strings.ToLower(visibility)})
	raw := apiCall(cfg, "POST", "/memos", body, "application/json")
	fmt.Printf("%v  %s\n", jnum(raw, "id"), truncate(jstr(raw, "content"), 60))
}

func cmdList(cfg Config, args []string) {
	page := "1"
	if len(args) >= 1 {
		page = args[0]
	}
	raw := apiCall(cfg, "GET", "/memos?page="+page+"&page_size=20", nil, "")
	for _, it := range jlist(raw, "items") {
		m, _ := it.(map[string]any)
		if m == nil {
			continue
		}
		id, _ := m["id"].(float64)
		content, _ := m["content"].(string)
		pin := "  "
		if p, _ := m["pinned"].(bool); p {
			pin = "📌"
		}
		fmt.Printf("%d\t%s\t%s\n", int(id), pin, truncate(strings.ReplaceAll(content, "\n", " "), 80))
	}
}

func cmdSearch(cfg Config, args []string) {
	if len(args) < 1 {
		fatalf("用法：babble search <关键词>")
	}
	raw := apiCall(cfg, "GET", "/memos?keyword="+args[0], nil, "")
	for _, it := range jlist(raw, "items") {
		m, _ := it.(map[string]any)
		id, _ := m["id"].(float64)
		content, _ := m["content"].(string)
		fmt.Printf("%d\t%s\n", int(id), truncate(strings.ReplaceAll(content, "\n", " "), 80))
	}
}

func cmdShow(cfg Config, args []string) {
	if len(args) < 1 {
		fatalf("用法：babble show <id>")
	}
	raw := apiCall(cfg, "GET", "/memos/"+args[0], nil, "")
	fmt.Println(jstr(raw, "content"))
}

func cmdEdit(cfg Config, args []string) {
	if len(args) < 1 {
		fatalf("用法：babble edit <id> [新内容]（无内容时读 stdin）")
	}
	text := strings.Join(args[1:], " ")
	if text == "" {
		b, _ := io.ReadAll(os.Stdin)
		text = string(b)
	}
	body, _ := json.Marshal(map[string]string{"content": strings.TrimSpace(text)})
	apiCall(cfg, "PATCH", "/memos/"+args[0], body, "application/json")
	fmt.Printf("✅ 已更新 #%s\n", args[0])
}

func cmdAction(cfg Config, action string, args []string) {
	if len(args) < 1 {
		fatalf("用法：babble %s <id>", action)
	}
	apiCall(cfg, "POST", "/memos/"+args[0]+"/"+action, []byte("{}"), "application/json")
	label := map[string]string{"pin": "置顶", "archive": "归档"}[action]
	fmt.Printf("✅ %s已切换 #%s\n", label, args[0])
}

func cmdDelete(cfg Config, args []string) {
	if len(args) < 1 {
		fatalf("用法：babble delete <id>")
	}
	apiCall(cfg, "DELETE", "/memos/"+args[0], nil, "")
	fmt.Printf("✅ 已删除 #%s\n", args[0])
}

func cmdUpload(cfg Config, args []string) {
	if len(args) < 1 {
		fatalf("用法：babble upload <文件> [memoId]")
	}
	f, err := os.Open(args[0])
	if err != nil {
		fatal("无法打开文件：%v", err)
	}
	defer f.Close()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, _ := w.CreateFormFile("file", filepath.Base(args[0]))
	_, _ = io.Copy(fw, f)
	if len(args) >= 2 {
		_ = w.WriteField("memoId", args[1])
	}
	_ = w.Close()

	url := strings.TrimRight(cfg.Server, "/") + "/api/v1/resources/upload"
	req, err := http.NewRequest("POST", url, &buf)
	if err != nil {
		fatal("构造请求失败：%v", err)
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("Content-Type", w.FormDataContentType())
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fatal("上传失败：%v", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		fatalf("上传失败（%d）：%s", resp.StatusCode, truncate(string(data), 200))
	}
	fmt.Printf("%v\t%s\t%s\n", jnum(data, "id"), jstr(data, "url"), jstr(data, "name"))
}

func cmdHelp() {
	fmt.Print(`babble —— Babble CLI（Go 版，说说快速发布 / 管理）

用法：
  babble login <用户名> <密码>     登录并保存长期 token
  babble server [URL]              查看/设置服务器地址
  babble "内容..."                 快速发布说说（等价 post）
  babble post [-v PUBLIC] "内容"   发布（-v 指定可见性）
  babble list [页码]               列表
  babble search <关键词>           搜索
  babble show <id>                 查看
  babble edit <id> "新内容"        编辑
  babble pin <id>                  置顶切换
  babble archive <id>              归档切换
  babble delete <id>               删除
  babble upload <文件> [memoId]    上传资源
  babble migrate <旧站URL> <token> [--limit N] [--dry-run]
                                   一键迁移旧 memos 站数据
  babble help                      本帮助

配置：Windows 存 %APPDATA%\babble\config.json；macOS/Linux 存
~/.config/babble/config.json。环境变量 BABBLE_SERVER / BABBLE_TOKEN 优先。

管道示例：
  echo "来自 stdin" | babble post
  git log -1 --format=%B | babble
`)
}

func main() {
	cfg := loadConfig()
	args := os.Args[1:]
	cmd := ""
	if len(args) > 0 {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "login":
		cmdLogin(cfg, args)
	case "server":
		cmdServer(cfg, args)
	case "post":
		cmdPost(cfg, args)
	case "list":
		cmdList(cfg, args)
	case "search":
		cmdSearch(cfg, args)
	case "show":
		cmdShow(cfg, args)
	case "edit":
		cmdEdit(cfg, args)
	case "pin":
		cmdAction(cfg, "pin", args)
	case "archive":
		cmdAction(cfg, "archive", args)
	case "delete", "rm":
		cmdDelete(cfg, args)
	case "upload":
		cmdUpload(cfg, args)
	case "migrate":
		cmdMigrate(cfg, args)
	case "help", "-h", "--help", "":
		cmdHelp()
	default:
		cmdPost(cfg, append([]string{cmd}, args...)) // babble "说说内容" 直接发布
	}
	_ = sha256.New // 保留 crypto/sha256 供未来 token 校验扩展
	_ = hex.EncodeToString
}

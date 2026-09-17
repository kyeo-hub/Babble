package main

// migrate 子命令：一键从旧 memos 站（v0.18~v0.26 API）迁移到 Babble
// 用法：babble migrate <旧站地址> <旧站token> [--limit N] [--dry-run]
//
// 流程：探测 API 形态（v1 gRPC-Gateway / legacy）→ 分页拉取 memos + 资源
// → 资源下载转 base64 → 分批 POST /migrate/import（uid 幂等）→ 汇总报告。

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ---------- 旧站 API 客户端 ----------

type legacyClient struct {
	host  string
	token string
	http  *http.Client
}

func newLegacyClient(host, token string) *legacyClient {
	return &legacyClient{
		host:  strings.TrimRight(host, "/"),
		token: token,
		http:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (lc *legacyClient) get(path string, query url.Values, out any) error {
	u := lc.host + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+lc.token)
	resp, err := lc.http.Do(req)
	if err != nil {
		return fmt.Errorf("无法连接旧站 %s：%v", lc.host, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 401 {
		return fmt.Errorf("旧站 token 无效（401）")
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("旧站 %s 返回 %d：%s", path, resp.StatusCode, truncate(string(data), 160))
	}
	return json.Unmarshal(data, out)
}

func (lc *legacyClient) download(urlPath string) ([]byte, string, error) {
	u := urlPath
	if !strings.HasPrefix(u, "http") {
		u = lc.host + u
	}
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+lc.token)
	resp, err := lc.http.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("资源下载 %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return nil, "", err
	}
	return data, resp.Header.Get("Content-Type"), nil
}

// ---------- 旧站数据结构（两代 API 的字段并集） ----------

type legacyResource struct {
	Name         string `json:"name"`     // v1: resources/{uid}
	Id           any    `json:"id"`       // legacy: 数字 id
	Uid          string `json:"uid"`      // legacy: uid
	Filename     string `json:"filename"` // v1
	Type         string `json:"type"`
	MimeType     string `json:"mimeType"` // legacy
	Size         any    `json:"size"`
	ExternalLink string `json:"externalLink"`
	PublicId     string `json:"publicId"` // legacy
}

type legacyMemo struct {
	Name        string           `json:"name"` // v1: memos/{uid}
	Id          any              `json:"id"`   // legacy: 数字 id
	Uid         string           `json:"uid"`  // legacy
	Content     string           `json:"content"`
	Visibility  string           `json:"visibility"` // v1 大写 / legacy 小写
	Pinned      bool             `json:"pinned"`
	RowStatus   string           `json:"rowStatus"`  // legacy
	State       string           `json:"state"`      // v1
	CreatedTs   any              `json:"createdTs"`  // legacy: 秒
	CreateTime  string           `json:"createTime"` // v1: ISO
	UpdatedTs   any              `json:"updatedTs"`
	UpdateTime  string           `json:"updateTime"`
	Resources   []legacyResource `json:"resources"`   // legacy 内嵌
	Attachments []legacyResource `json:"attachments"` // v1 内嵌
}

// ---------- 归一化 ----------

func anyToTs(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case string:
		if t, err := time.Parse(time.RFC3339, x); err == nil {
			return t.Unix()
		}
	}
	return 0
}

func (m *legacyMemo) memoUid() string {
	if m.Uid != "" {
		return m.Uid
	}
	if strings.HasPrefix(m.Name, "memos/") {
		return strings.TrimPrefix(m.Name, "memos/")
	}
	return fmt.Sprintf("legacy-%v", m.Id)
}

func (m *legacyMemo) isArchived() bool {
	if m.RowStatus == "ARCHIVED" || m.RowStatus == "archived" {
		return true
	}
	return m.State == "ARCHIVED"
}

func (m *legacyMemo) memoVisibility() string {
	v := strings.ToLower(m.Visibility)
	if v == "public" || v == "protected" {
		return v
	}
	return "private"
}

func (r *legacyResource) resName() string {
	if r.Filename != "" {
		return r.Filename
	}
	if r.Name != "" && strings.Contains(r.Name, "/") {
		parts := strings.SplitN(r.Name, "/", 2)
		return parts[1]
	}
	return fmt.Sprintf("resource-%v", r.Id)
}

func (r *legacyResource) resType() string {
	if r.Type != "" {
		return r.Type
	}
	if r.MimeType != "" {
		return r.MimeType
	}
	return "application/octet-stream"
}

func (r *legacyResource) resUid() string {
	if r.Uid != "" {
		return r.Uid
	}
	if strings.HasPrefix(r.Name, "resources/") {
		return strings.TrimPrefix(r.Name, "resources/")
	}
	return ""
}

// v1 附件下载路径：/file/attachments/{uid}/{filename}
func (r *legacyResource) resPath() string {
	if r.ExternalLink != "" && strings.HasPrefix(r.ExternalLink, "http") {
		return r.ExternalLink
	}
	uid := r.resUid()
	if uid != "" {
		return "/file/attachments/" + url.PathEscape(uid) + "/" + url.PathEscape(r.resName())
	}
	if r.PublicId != "" {
		return "/file/" + r.PublicId + "/" + url.PathEscape(r.resName())
	}
	return ""
}

// ---------- 导入 payload ----------

type importResource struct {
	MemoIndex  int    `json:"memoIndex"`
	Uid        string `json:"uid,omitempty"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	Size       int64  `json:"size,omitempty"`
	DataBase64 string `json:"dataBase64"`
}

type importMemo struct {
	Uid        string `json:"uid"`
	Content    string `json:"content"`
	Visibility string `json:"visibility"`
	Pinned     int    `json:"pinned"`
	RowStatus  string `json:"rowStatus"`
	CreatedTs  int64  `json:"createdTs"`
	UpdatedTs  int64  `json:"updatedTs,omitempty"`
}

type importPayload struct {
	BatchId   string           `json:"batchId,omitempty"`
	Memos     []importMemo     `json:"memos"`
	Resources []importResource `json:"resources"`
}

type importReport struct {
	BatchId           string `json:"batchId"`
	ImportedMemos     int    `json:"importedMemos"`
	ImportedResources int    `json:"importedResources"`
	SkippedResources  int    `json:"skippedResources"`
}

// ---------- migrate 主流程 ----------

const (
	migrateBatchMemos    = 20               // 每批 memo 数
	migrateMaxBatchBytes = 36 * 1024 * 1024 // base64 总量控制在 ~36MB（服务端上限 50MB）
)

func cmdMigrate(cfg Config, args []string) {
	var oldHost, oldToken string
	limit := 0
	dryRun := false
	var rest []string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--limit":
			if i+1 < len(args) {
				fmt.Sscanf(args[i+1], "%d", &limit)
				i++
			}
		case "--dry-run":
			dryRun = true
		default:
			rest = append(rest, args[i])
		}
	}
	if len(rest) < 2 {
		fatalf(`用法：babble migrate <旧站地址> <旧站token> [--limit N] [--dry-run]

示例：
  babble migrate https://memos.example.com eyJhbGci...（旧站 Settings 里生成的 Access Token）
  babble migrate https://memos.example.com <token> --limit 50   # 先试迁 50 条
  babble migrate https://memos.example.com <token> --dry-run    # 只统计不写入`)
	}
	oldHost, oldToken = strings.TrimRight(rest[0], "/"), rest[1]
	if !strings.HasPrefix(oldHost, "http") {
		oldHost = "https://" + oldHost
	}

	lc := newLegacyClient(oldHost, oldToken)

	// 1) 探测 API 形态：v1（gRPC-Gateway，memos/{uid} 形状）或 legacy（v0.18 数组形状）
	var memos1 []legacyMemo
	if err := lc.get("/api/v1/memos", url.Values{"pageSize": {"1"}}, &struct {
		Memos *[]legacyMemo `json:"memos"`
	}{&memos1}); err == nil && len(memos1) > 0 {
		fmt.Println("探测：v1 gRPC-Gateway API（memos v0.22+）")
	} else {
		var legacy []legacyMemo
		// v0.18 legacy：POST /api/v1/memo:list 不存在，用 GET memo/all 或 memo:list
		if err := lc.get("/api/v1/memo/all", nil, &struct {
			Memos *[]legacyMemo `json:"memos"`
		}{&legacy}); err != nil {
			_ = lc.get("/api/v1/memo:list", nil, &struct {
				Memos *[]legacyMemo `json:"memos"`
			}{&legacy})
		}
		memos1 = legacy
		if len(legacy) > 0 {
			fmt.Println("探测：legacy API（memos v0.18~v0.21）")
		}
	}

	// 2) 分页全量拉取
	all := memos1
	pageToken := ""
	for {
		q := url.Values{"pageSize": {"200"}}
		if pageToken != "" {
			q.Set("pageToken", pageToken)
		}
		var page struct {
			Memos         []legacyMemo `json:"memos"`
			NextPageToken string       `json:"nextPageToken"`
		}
		if err := lc.get("/api/v1/memos", q, &page); err != nil {
			break
		}
		if len(page.Memos) == 0 {
			break
		}
		all = append(all, page.Memos...)
		if page.NextPageToken == "" {
			break
		}
		pageToken = page.NextPageToken
	}
	if len(all) == 0 {
		fatalf("旧站没有拉取到任何 memo（检查地址/token，或站内本来就无数据）")
	}
	if limit > 0 && len(all) > limit {
		all = all[:limit]
	}
	fmt.Printf("拉取：%d 条 memo\n", len(all))

	// 3) 分批转换 + 下载资源 + 导入
	totalImported, totalRes, totalSkip, totalResFail := 0, 0, 0, 0
	batchId := fmt.Sprintf("cli-%d", time.Now().Unix())

	for start := 0; start < len(all); start += migrateBatchMemos {
		end := start + migrateBatchMemos
		if end > len(all) {
			end = len(all)
		}
		payload := importPayload{BatchId: fmt.Sprintf("%s-%d", batchId, start)}
		batchBytes := 0

		for i := start; i < end; i++ {
			m := &all[i]
			payload.Memos = append(payload.Memos, importMemo{
				Uid:        m.memoUid(),
				Content:    m.Content,
				Visibility: m.memoVisibility(),
				Pinned:     boolToInt(m.Pinned),
				RowStatus:  map[bool]string{true: "archived", false: "normal"}[m.isArchived()],
				CreatedTs:  anyToTs(m.CreatedTs) | anyToTsFallback(m.CreateTime),
				UpdatedTs:  anyToTs(m.UpdatedTs) | anyToTsFallback(m.UpdateTime),
			})

			// 资源（两代字段并集）
			atts := append(m.Resources, m.Attachments...)
			for ri, r := range atts {
				if dryRun {
					fmt.Printf("  [dry] memo %s 资源 %s\n", m.memoUid(), r.resName())
					continue
				}
				path := r.resPath()
				if path == "" {
					totalSkip++
					continue
				}
				data, ctype, err := lc.download(path)
				if err != nil || len(data) == 0 {
					fmt.Printf("  ⚠️ 资源下载失败（%s）：%v\n", r.resName(), err)
					totalResFail++
					continue
				}
				if ctype == "" {
					ctype = r.resType()
				}
				b64 := base64.StdEncoding.EncodeToString(data)
				batchBytes += len(b64)
				if batchBytes > migrateMaxBatchBytes {
					fmt.Printf("  ⚠️ 资源 %s 过大，跳过（建议用补迁工具单独处理）\n", r.resName())
					totalSkip++
					continue
				}
				payload.Resources = append(payload.Resources, importResource{
					MemoIndex:  i - start,
					Uid:        r.resUid(),
					Name:       r.resName(),
					Type:       ctype,
					Size:       int64(len(data)),
					DataBase64: b64,
				})
				_ = ri
			}
		}

		if dryRun {
			fmt.Printf("  [dry] 批次 %d~%d：%d 条 memo\n", start, end, end-start)
			continue
		}

		// 4) 提交批次（uid 幂等：重跑只补缺失的）
		body, _ := json.Marshal(payload)
		raw := apiCall(cfg, "POST", "/migrate/import", body, "application/json")
		var rep importReport
		_ = json.Unmarshal(raw, &rep)
		totalImported += rep.ImportedMemos
		totalRes += rep.ImportedResources
		totalSkip += rep.SkippedResources
		fmt.Printf("  批次 %d~%d ✅ memo +%d 资源 +%d（跳过 %d）\n",
			start, end, rep.ImportedMemos, rep.ImportedResources, rep.SkippedResources)
	}

	fmt.Println("\n========== 迁移报告 ==========")
	fmt.Printf("memo 导入：%d / %d\n", totalImported, len(all))
	fmt.Printf("资源导入：%d（跳过 %d，失败 %d）\n", totalRes, totalSkip, totalResFail)
	if totalImported == 0 && !dryRun {
		fmt.Println("（0 条新增 = 全部已导入过，幂等跳过——数据已就位）")
	}
	fmt.Println("提示：内容中的旧图片链接（/o/r/、/file/）可用补迁工具重写；分享/实时等为新站独立功能。")
}

func anyToTsFallback(iso string) int64 {
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.Unix()
	}
	return 0
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

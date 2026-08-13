# Babble API 契约（v1）

> 全新设计的 REST API，面向 Web 前端 / Android APP / 微信小程序 / Telegram bot 统一对接。
> 所有时间戳为 unix 秒；所有请求/响应均为 JSON（除资源上传/下载）。
> 服务端只存与返回 **markdown 原文**，渲染由各端自行完成。

## 1. 通用约定

### Base URL

| 环境 | URL |
|---|---|
| 生产（workers.dev） | `https://babble.<用户名>.workers.dev` |
| 生产（自定义域名） | `https://bb.kyeo.top` |
| 本地开发 | `http://localhost:8787` |

统一前缀：`/api/v1`（下文中省略）。OpenAPI 规范：`GET /openapi.json`，Swagger UI：`GET /doc`。

### 鉴权（二选一，两者都可用）

| 方式 | 头 | 适用 |
|---|---|---|
| JWT | `Authorization: Bearer <jwt>` | Web / APP 登录会话 |
| 长期 API Token | `X-API-Token: <token>` | Telegram bot / 小程序 / 自动化 |

401 响应：`{"error":{"code":"UNAUTHORIZED","message":"..."}}`

### 统一错误格式

```json
{ "error": { "code": "INVALID_ARGUMENT|UNAUTHORIZED|NOT_FOUND|CONFLICT|RATE_LIMITED|INTERNAL", "message": "人类可读描述" } }
```

### 分页约定

列表接口统一使用：

| 参数 | 默认 | 说明 |
|---|---|---|
| `page` | 1 | 页码（1 起） |
| `page_size` | 20 | 每页条数，最大 100 |
| `pinned_first` | true | 置顶 memo 优先排序 |

响应统一为：

```json
{ "items": [...], "page": 1, "page_size": 20, "total": 137 }
```

## 2. 数据模型（JSON 表示）

```jsonc
// Memo
{
  "id": 42,                     // 数据库 id（数字）
  "uid": "abcd1234",            // 对外稳定标识（分享/引用用）
  "content": "# 标题\n正文…",    // markdown 原文
  "visibility": "private",      // public | private
  "pinned": false,
  "rowStatus": "normal",        // normal | archived
  "tags": ["工作", "随笔"],     // 由 content 派生，只读
  "resources": [{"id": 1, "uid": "…", "name": "a.png", "type": "image/png", "size": 1024}],
  "createdTs": 1720000000,
  "updatedTs": 1720000000
}

// User
{ "id": 1, "uid": "…", "username": "admin", "role": "admin", "createdTs": 1720000000 }

// Resource
{ "id": 1, "uid": "…", "memoId": 42, "name": "a.png", "type": "image/png", "size": 1024, "url": "/api/v1/resources/1/file" }

// Tag
{ "name": "工作", "memoCount": 12 }
```

## 3. 认证接口

### POST `/auth/login`

请求：`{"username":"admin","password":"…"}`
响应 200：

```json
{ "accessToken": "<jwt>", "refreshToken": "<jwt>", "user": { ...User } }
```

### POST `/auth/refresh`

请求：`{"refreshToken":"<jwt>"}` → 响应同 login（新 token 对）。

### POST `/auth/register`

默认 404（单用户优先，仅通过种子账号初始化）。未来多用户时启用。

### GET `/me`

返回当前用户 `{ ...User }`。

### POST `/auth/tokens`（bot / APP 长期凭证）

请求：`{"name":"telegram-bot"}` → 响应：

```json
{ "token": "bab_xxxxxxxx", "createdTs": 1720000000 }
```

`token` 明文只返回一次；服务端只存哈希。后续请求带 `X-API-Token: bab_xxxxxxxx`。

### DELETE `/auth/tokens/:id` / GET `/auth/tokens`

吊销 / 列出当前用户的 API Token。

## 4. Memo 接口

### GET `/memos` — 列表/过滤/搜索

| 参数 | 说明 |
|---|---|
| `page`, `page_size` | 分页 |
| `tag` | 按标签过滤（可重复传，多标签 AND） |
| `visibility` | `public` / `private`（不传=全部） |
| `archived` | `true`=只看已归档；默认只看未归档；`all`=全部 |
| `keyword` | 内容包含关键字（LIKE，大小写不敏感） |
| `start_ts`, `end_ts` | 时间范围过滤（创建时间） |

### POST `/memos` — 创建

请求：`{"content":"markdown…","visibility":"private"}` → 响应 201 `{ ...Memo }`。

### GET `/memos/:id` — 详情

按数字 id 或 uid 均可。→ `{ ...Memo }`（含 resources）。

### PATCH `/memos/:id` — 更新

请求（任意可省字段）：`{"content":"…","visibility":"public","pinned":true,"rowStatus":"archived"}` → `{ ...Memo }`。

### DELETE `/memos/:id`

→ 204。级联删除关联 resource 记录（R2 对象一并清理）。

### POST `/memos/:id/pin` — 置顶切换

→ `{ ...Memo }`（服务端翻转 pinned 并返回新状态）。

### POST `/memos/:id/archive` — 归档切换

→ `{ ...Memo }`（翻转 rowStatus）。

## 5. 标签接口

### GET `/tags`

→ `{ "items": [ { "name": "工作", "memoCount": 12 } ], "total": 3 }`
标签由全部 memo 内容中的 `#tag` 派生统计。

## 6. 资源接口（R2）

### POST `/resources/upload` — 上传

`multipart/form-data`，字段 `file`（可选 `memoId`、`name`）。
→ 201 `{ ...Resource }`（含 `url`）。

限制：单文件 ≤ 10MB（请求体限制，R2 本身无此限制）。

### GET `/resources/:id/file` — 下载/图片直出

- 带鉴权：返回文件流，`Content-Type` 为原 mime；
- 公开分享场景：使用分享短码 URL（见第 7 节），无需鉴权。

### GET `/resources/:id/meta`

→ `{ ...Resource }`（不含二进制）。

### DELETE `/resources/:id`

→ 204（删记录 + R2 对象）。

## 7. 分享接口

### POST `/memos/:id/share` — 生成公开分享

→ 200：

```json
{ "shareUrl": "https://bb.kyeo.top/p/AbCdEf123", "expiresTs": null }
```

- `expiresTs` 为 null 表示永久；只允许分享 `visibility=public` 的 memo；
- 短码存 KV：`share:<code> → memoUid`；
- 撤销（`{"revoke":true}`）删除 KV 键存在**最终一致性窗口**（通常数秒、最长约 60 秒），窗口内短码仍可能可访问，严格场景可轮询确认。

### GET `/p/:code` — 公开访问（无鉴权）

→ `{ ...Memo }`（不含 private 字段以外的敏感信息）。前端拿 content 自行渲染 markdown。

### DELETE 分享（复用 `POST /memos/:id/share` 传 `{"revoke":true}`）

撤销短码。

## 8. 实时推送

### GET `/ws` — WebSocket（P4 实现）

握手需带 JWT（query `?token=<jwt>` 或子协议头）。
连接后服务端推送事件（见下），客户端无需回包。

### GET `/events` — SSE（P4 实现，小程序/低端客户端友好）

`?token=<jwt>&since=<ts>`：`since` 用于断线补偿，补发该时间点后的变更事件。

### 事件负载

```json
{ "type": "memo.created|memo.updated|memo.deleted|memo.pinned", "data": { ...Memo 或 memo uid } }
```

事件按 memo 的 `visibility` 过滤，单用户阶段即全量广播。

## 9. Telegram bot Webhook

### POST `/webhooks/telegram`（无需业务鉴权，用 secret token 校验）

Telegram 更新（新消息 → 创建 memo；`/list` 等命令按需扩展）。出站推送由 bot 主动调 Telegram API。

配置（环境变量）：`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`（可选白名单）、`TELEGRAM_WEBHOOK_SECRET`。

## 10. 错误码速查

| code | HTTP | 场景 |
|---|---|---|
| `INVALID_ARGUMENT` | 400/422 | 参数校验失败（Zod） |
| `UNAUTHORIZED` | 401 | 未登录 / token 失效 / 黑名单 |
| `FORBIDDEN` | 403 | 无权限（多用户后） |
| `NOT_FOUND` | 404 | memo/资源不存在，或 register 未启用 |
| `CONFLICT` | 409 | 用户名/标签重复等 |
| `RATE_LIMITED` | 429 | 登录限流 / 频率超限 |
| `INTERNAL` | 500 | 未知错误 |

## 11. 变更记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1-draft | 2026-08-12 | P0 冻结初稿 |
| v1-p1 | 2026-08-13 | P1 已实现：认证（login/refresh/me/tokens）+ memo CRUD/分页/过滤/置顶/归档 |
| v1-p2 | 2026-08-13 | P2 已实现：资源上传（multipart→R2）/meta/文件直出/删除；memo 详情与列表填充 `resources`；删除 memo 级联清理资源 |
| v1-p3 | 2026-08-13 | P3 已实现：标签（`#tag` 派生填充 memo 输出 + `GET /tags` 统计）、公开分享（`POST /memos/{id}/share` 短码存 KV + 无鉴权 `GET /p/{code}`，仅 public）、keyword 多关键字 AND 分词 |

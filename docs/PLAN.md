# Babble 项目方案（基于 Cloudflare 的 memos 复刻后端）

> 目标：在 Cloudflare 生态上实现一个 memos 复刻版笔记服务，只做后端 API。
> 前端 / Android APP / 微信小程序 / Telegram bot 全部通过 API 接入，markdown 由各端自行渲染。
> 现有 memos 数据在项目完成后迁移。

## 已确认决策

| 决策点 | 选择 |
|---|---|
| 技术底座 | Cloudflare Workers + Hono + D1 + R2 + KV + Durable Objects |
| API 风格 | **全新设计**（不兼容 memos v1，按需简洁） |
| 用户体系 | **单用户优先**（隐藏注册，认证最简，多用户可后加） |
| 实时推送 | **需要**：Durable Objects + WebSocket/SSE |
| 迁移工具 | **双路径**：SQLite DB 直转 + memos API 拉取，统一中间格式 |

---

## 1. 技术栈

| 组件 | 选型 | 职责 |
|---|---|---|
| 运行时 | Cloudflare Workers（Hono，TypeScript） | 全部 API 逻辑 |
| 数据库 | D1（SQLite 同源） | 主存储，与 memos 血统一致，迁移友好 |
| 对象存储 | R2 | 图片/附件（对应 memos resource） |
| 缓存/会话 | KV | JWT 黑名单、登录限流、分享短码 |
| 实时推送 | Durable Objects（MemoHub） | WS/SSE 连接与事件广播 |
| 定时任务 | Cron Triggers | 定期备份 D1 → R2 |
| 校验/文档 | Zod + @hono/zod-openapi | 入参校验 + 自动生成 OpenAPI 契约 |
| ORM | Drizzle（drizzle-kit） | schema 定义 + 迁移文件管理 |

部署形态：`wrangler` 一键部署到自定义域名（小程序强制要求 HTTPS + 域名白名单）。

## 2. 系统架构

```
                    ┌─────────────────────────────────────────┐
                    │            Cloudflare Workers           │
                    │                                         │
  Web前端 ────────▶ │  Hono Router (所有 /api/v1/*)           │
  Android ────────▶ │    ├─ middleware: JWT / API Token / 限流 │
  小程序 ─────────▶ │    ├─ routes: auth / memos / tags /      │
  TG bot ─────────▶ │    │            resources / share / ws   │
                    │    └─ services + Drizzle                 │
                    ├─────────────────────────────────────────┤
                    │  Durable Object: MemoHub                 │
                    │   (WS/SSE 连接 + 变更事件广播)           │
                    ├──────────────┬─────────────┬────────────┤
                    │      D1      │     R2      │     KV     │
                    │   (SQLite)   │ (附件/图片) │ (令牌/限流) │
                    └──────────────┴─────────────┴────────────┘
```

- memo 变更（增/改/删/置顶/归档）时，service 层同步向 MemoHub 广播事件；
- 客户端可订阅 WS 或 SSE 实时刷新，离线客户端（bot）用轮询/事件补偿。

## 3. 数据模型（D1 表）

```sql
users         id, uid, username, password_hash, role, created_ts, updated_ts
api_tokens    id, token_hash, user_id, name, created_ts, last_used_ts   -- bot/APP 长期凭证
memos         id, uid, creator_id, content, visibility, pinned, row_status,
              created_ts, updated_ts
tags          id, name, creator_id, created_ts   -- UNIQUE(name, creator_id)
resources     id, uid, memo_id, creator_id, name, type, size,
              storage_key, created_ts
```

- `visibility`: 单用户阶段 `public | private`（公开=可被分享链接/无鉴权读到），多用户时再加 `protected`；
- `row_status`: `normal | archived`；
- `content` 存 markdown 原文，渲染一律交给各端，后端不做 HTML；
- `pinned` 为 `0/1`，查询时置顶优先排序。

## 4. API 设计（全新设计，OpenAPI 契约驱动）

统一前缀 `/api/v1`，JWT 或 `X-API-Token` 鉴权。

### 认证
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/auth/login` | 返回 access JWT + refresh token |
| POST | `/api/v1/auth/refresh` | 刷新 JWT |
| POST | `/api/v1/auth/register` | 默认关闭；仅首启种子账号 |
| GET | `/api/v1/me` | 当前用户信息 |
| POST | `/api/v1/auth/tokens` | 签发长期 API Token（bot/APP 用） |

### Memo
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/memos` | 分页 + 过滤（tag / visibility / archived / keyword / 时间范围） |
| POST | `/api/v1/memos` | 创建（content, visibility, tags） |
| GET | `/api/v1/memos/:id` | 详情 |
| PATCH | `/api/v1/memos/:id` | 更新内容/可见性/置顶/归档 |
| DELETE | `/api/v1/memos/:id` | 删除 |

### 标签 / 资源
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/tags` | 标签列表 + memo 计数 |
| POST | `/api/v1/resources/upload` | multipart → R2，返回 resource 信息 |
| GET | `/api/v1/resources/:id` | 下载/图片直出（带鉴权或公开短码） |
| GET | `/api/v1/resources/:id/meta` | 元信息 |
| DELETE | `/api/v1/resources/:id` | 删除（含 R2 对象） |

### 分享 / 实时
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/memos/:id/share` | 生成公开分享短码（KV 存映射） |
| GET | `/p/:token` | 公开 JSON（content + 资源），无鉴权 |
| GET | `/api/v1/ws` | WebSocket 订阅变更事件（DO） |
| GET | `/api/v1/events` | SSE 备选通道（小程序/低端客户端友好） |

### Webhook
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/webhooks/telegram` | TG bot 收消息 → 存 memo；新 memo → 推回 TG |

事件负载统一为：`{ type: "memo.created|updated|deleted|pinned", data: {...} }`。

## 5. 实时推送设计（Durable Objects）

- **MemoHub DO**：每个客户端 `connect` 到 DO，DO 维护连接集合并把事件推给订阅者；
- 单用户阶段直接广播全部事件；预留 `visibility` 过滤逻辑，多用户时按可见性过滤；
- WS 与 SSE 双通道：APP/Web 用 WS，小程序/简单站点用 SSE（避免 WS 兼容问题）；
- 断线补偿：客户端重连后用 `?since=<ts>` 拉取增量，配合全量列表兜底。

## 6. 认证设计（单用户优先）

1. 首启通过环境变量 `SEED_ADMIN_USERNAME/PASSWORD` 初始化唯一管理员（`register` 默认 404）；
2. 登录 → 短时 JWT（如 1h）+ refresh token（KV 存白名单）；
3. 长期 **API Token**：`POST /auth/tokens` 签发，存哈希；bot/小程序用 `X-API-Token` 头，可独立吊销；
4. 登录限流：KV 按 IP/用户名计数，防爆破。

## 7. 迁移工具（双路径，`scripts/migrate/`）

```
memos.db ──▶ A. SQLite 直转 ──┐
memos API ─▶ B. API 拉取 ────┼──▶ 统一中间 JSON ──▶ 导入器 ──▶ D1 + R2
                              │      (memos/resources/tags)
                              └── resource 原文件 ──▶ R2 上传
```

- **路径 A（DB 直转，推荐）**：本地 Node 脚本读 `memos.db`，提取 memo（content/visibility/pinned/row_status/created_ts）、resource、tag；resource 二进制上传 R2；
- **路径 B（API 拉取）**：调 memos v1 API 分页拉 JSON，同样产出中间格式；适合无服务器权限的托管版；
- **导入器**：校验 → 批量写 D1（`wrangler d1 execute --file` 或逐条插入）→ 生成一致性报告：memo 数 / 资源数 / 标签数 / 时间戳抽样比对；
- 工具在本地跑，Worker 里只暴露幂等的导入/验证接口。

## 8. 分阶段路线

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| P0 | 冻结 OpenAPI 契约 + D1 schema | `docs/api.md` + schema 文件评审通过 |
| P1 | 工程骨架：wrangler + Hono + Drizzle + 认证 + memo CRUD + 分页 | `curl` 全流程可用 |
| P2 | 资源：R2 上传/下载/图片代理 | 图片可传可读 |
| P3 | 标签 / 置顶 / 归档 / 搜索 / 公开分享 | 功能齐备 |
| P4 | 实时：MemoHub DO + WS/SSE | 双端订阅收到变更 |
| P5 | Telegram bot（webhook 收发 + markdown 渲染） | bot 双向可用 |
| P6 | 迁移工具双路径 + 老站数据迁移验证 | 一致性报告通过 |
| P7 | Android / 小程序按 SDK 接入；老 memos 下线、切换域名 | 客户端可用 |

## 9. 限制与风险

| 风险 | 对策 |
|---|---|
| D1 写入并发有限 | 个人单用户量级完全够用；写操作加串行队列缓冲 |
| D1 暂不支持 FTS5 | 搜索先用 LIKE + 时间范围过滤；量大再评估外部索引 |
| 小程序要求备案域名 | 上线前准备已备案自定义域名 |
| TG bot 断线/重放 | webhook + secret token 校验，失败事件落 KV 重试 |
| 数据安全 | Cron 定期导出 D1 快照到 R2，资源双备份 |
| 迁移丢失风险 | 老站保留不下线，验证通过再切域名 |

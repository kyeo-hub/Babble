# Babble

基于 **Cloudflare Workers** 的 memos 复刻说说/笔记服务 —— 后端 API + CLI，零本地服务器、全托管免费额度运行。任意客户端（CLI / 快捷指令 / curl / 自建端）通过 REST API 调用。

## 特性

- 🗒️ Memo CRUD：创建 / 编辑 / 删除 / 置顶 / 归档
- 🏷️ 标签（`#tag` 派生）、关键字与时间范围搜索
- 🔒 可见性：public / private；公开分享短链
- 📎 图片与附件（R2 存储）
- ⚡ 实时推送（WebSocket / SSE，Durable Objects）
- 🔌 Memos v1 兼容层：memos-browers-plugin 等第三方客户端即插即用
- 📦 一键部署：fork 后填 3 个 Secret，GitHub Actions 自动完成 D1/KV/R2 创建与部署

技术栈：**Hono + Drizzle ORM + D1 + R2 + KV + Durable Objects**，TypeScript 全栈，OpenAPI 契约驱动（`GET /openapi.json`）。

## 文档

- 📖 [使用文档](docs/usage.md) —— 部署 / 数据迁移 / CLI / 浏览器插件 / API 速查 / 常见问题
- 📐 [API 契约](docs/api.md) —— 全部接口定义（线上 Swagger UI：`/doc`）
- ⬇️ [Releases](https://github.com/kyeo-hub/Babble/releases) —— CLI 各平台二进制（tag `cli-v*`）

## 快速开始（本地开发）

```bash
# 1. 安装依赖
npm install

# 2. 本地种子账号（可选，覆盖 vars）
cp .dev.vars.example .dev.vars   # 编辑 SEED_ADMIN_*

# 3. 本地运行（内置本地 D1，无需真实 Cloudflare 资源）
npm run dev                      # http://localhost:8787

# 4. 本地应用迁移
npm run db:migrate:local
```

验证：`curl http://localhost:8787/api/v1/health`

## 一键部署（别人 fork 你的仓库）

1. **Fork 本仓库**；
2. 在 Cloudflare 控制台创建 API Token（权限：`Workers Scripts:Edit`、`D1:Edit`、`R2:Edit`、`KV:Edit`、`Account Settings:Read`），拿到 Account ID；
3. 仓库 **Settings → Secrets and variables → Actions** 配置：

   | 名称 | 类型 | 说明 |
   |---|---|---|
   | `CLOUDFLARE_API_TOKEN` | Secret | 上面创建的 API Token |
   | `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare Account ID |
   | `SEED_ADMIN_PASSWORD` | Secret | 首启管理员密码（可选） |
   | `SEED_ADMIN_USERNAME` | Variable | 首启管理员用户名，默认 admin（可选） |

4. **Actions → Deploy to Cloudflare Workers → Run workflow**（或 push 到 main 自动触发）；
5. 完成后访问 `https://babble.<你的GitHub用户名>.workers.dev/api/v1/health`。

脚本会自动创建（不存在时）D1 数据库 `babble`、KV namespace、R2 桶，应用迁移并部署 Worker。

## 自定义域名

以 `bb.kyeo.top` 为例（要求域名已托管到 Cloudflare）：

1. 打开 `wrangler.jsonc`，取消注释并改为：

   ```jsonc
   "routes": [{ "pattern": "bb.kyeo.top", "custom_domain": true }],
   ```

2. 设置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 环境变量，然后 `npm run deploy`（或重新跑 Actions workflow）。
   `npm run deploy` 会先自动创建/复用 D1/KV/R2 并生成部署配置。

## memos 数据迁移

将旧 memos 站数据迁到 Babble，**推荐 CLI 一键迁移**（自动探测旧站 API 形态、资源转存 R2、按 uid 幂等可重跑）：

```bash
babble migrate https://memos.example.com <旧站token> --limit 10   # 先试迁 10 条
babble migrate https://memos.example.com <旧站token>              # 确认后全量
```

SQLite 直转（有 `memos.db` 文件时）等其它路径见 [使用文档 · 数据迁移](docs/usage.md#3-数据迁移)。

## CLI（推荐日常入口）

两个版本任选：**Go 单文件**（零依赖，Windows/macOS/Linux 全平台）或 bash 脚本（需 curl+jq）。

```bash
# Windows：从 Releases 下载 babble_*_windows_amd64.exe 重命名为 babble.exe，放入 PATH
# macOS/Linux：下载对应平台二进制（或用 bash 版一条命令安装）
curl -fsSL https://bb.kyeo.top/cli -o babble && sh babble --install

babble login <用户名> <密码>        # 一次性：签发长期 API token
babble "今天天气不错"               # 快速发布说说
echo "管道内容" | babble post       # stdin 发布
babble list / search / show / edit / pin / archive / delete / upload
babble tags / whoami / export [--md]     # 标签 / 令牌信息 / 全量导出
babble migrate <旧站URL> <旧站token>   # 一键迁移旧 memos 站（幂等，可重跑）
```

Go 版从 [Releases](https://github.com/kyeo-hub/Babble/releases) 下载（tag `cli-v*`，附 sha256sums.txt 校验）。

## Android APP（已移除）

> APP 已从仓库移除（历史版本 v0.3.5 仍可在 [Releases](https://github.com/kyeo-hub/Babble/releases/tag/v0.3.5) 下载，但不再维护）。日常使用推荐 [CLI](#cli推荐日常入口)。

## 项目结构

```
src/
├── index.ts              # Hono 入口：主页 / /cli / /doc + Memos 兼容层挂载
├── types.ts              # Env 绑定与通用类型
├── db/                   # Drizzle schema + client
├── routes/               # auth / memos / tags / resources / share / realtime / importer / memos-compat
├── lib/                  # auth / jwt / password / hash / tags / realtime
└── durable/memo-hub.ts   # 实时推送 DO
migrations/               # D1 迁移 SQL
cmd/babble/               # Go CLI（单文件，六平台发布）
scripts/
├── deploy/               # 一键部署脚本（ensure-infra / build-config / deploy.sh）
└── cli/                  # bash 版 CLI（macOS/Linux 一条命令安装）
tests/                    # vitest 单测（CI 门）
.github/workflows/        # deploy / cli-release / pages / reset-admin
```

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 工程骨架 + API 契约 + 一键部署 | ✅ |
| P1 | 认证 + memo CRUD + 分页 | ✅ |
| P2 | 资源上传（R2） | ✅ |
| P3 | 标签 / 分享 / 搜索 | ✅ |
| P4 | 实时推送（WS/SSE）+ 登录限流 | ✅ |
| P5 | 批量导入接口 | ✅ |
| P6 | memos 数据迁移（CLI migrate + SQLite 直转脚本） | ✅ |
| P7 | Memos v1 兼容层（浏览器插件）| ✅ |
| P8 | Go CLI 六平台发布 + 全量导出 | ✅ |
| P9 | FTS5 全文搜索 / Cron 清理 / Telegram bot | ⏳ |

## License

MIT

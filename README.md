# Babble

基于 **Cloudflare Workers** 的 memos 复刻笔记服务 —— 只做后端 API，markdown 渲染交给各端（Web / Android / 微信小程序 / Telegram bot）。

## 特性

- 🗒️ Memo CRUD：创建 / 编辑 / 删除 / 置顶 / 归档
- 🏷️ 标签（`#tag` 派生）、关键字与时间范围搜索
- 🔒 可见性：public / private；公开分享短链
- 📎 图片与附件（R2 存储）
- ⚡ 实时推送（WebSocket / SSE，Durable Objects）
- 🤖 Telegram bot webhook 双向对接
- 📦 一键部署：fork 后填 3 个 Secret，GitHub Actions 自动完成 D1/KV/R2 创建与部署

技术栈：**Hono + Drizzle ORM + D1 + R2 + KV + Durable Objects**，TypeScript 全栈，OpenAPI 契约驱动（`GET /openapi.json`）。

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

## memos 数据迁移（双路径）

将已有 memos 数据迁移到 Babble（工具位于 `scripts/migrate/`）：

### 第 1 步：提取（二选一）

```bash
# 路径 A：服务器上有 memos.db（SQLite 直转，本地存储的资源会一并提取）
node scripts/migrate/extract-sqlite.mjs /path/to/memos.db

# 路径 B：只有账号（托管版/外部存储资源），用 API 拉取（token 在 memos「设置 → API」生成）
node scripts/migrate/extract-api.mjs --url https://memos.kyeo.top --token <memos-token>
```

输出：`scripts/migrate/out/export.json`（中间格式）+ `out/resources/`（资源文件）。

### 第 2 步：导入（生成 SQL 与 R2 上传脚本）

```bash
# 目标库已有数据时用大 offset 避免 id 冲突（如 100000）
node scripts/migrate/import.mjs --id-offset 100000
```

输出：`out/migrate.sql` + `out/upload-r2.sh`。

### 第 3 步：执行（需 Cloudflare 凭据）

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ./scripts/migrate/run-migration.sh
```

脚本会：应用 D1 迁移 → 上传 R2 资源 → 输出一致性报告（计数 + 时间戳抽样，与源核对）。

> 说明：`protected` 可见性会映射为 `private`；`--id-offset` 需与导入时一致；建议先迁到空库或用大 offset 隔离。老站验证通过前保持运行，不要急于下线。

## Android APP

源码在 `android/`（Kotlin + Jetpack Compose），构建 debug APK：

```bash
cd android && ./gradlew :app:assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

功能：登录（JWT）、memo 列表（Markdown 渲染）/新建/编辑、memos 数据迁移页。

- **服务器地址可配置**：登录页与「设置」页（列表右上角 ⚙）可填写后端地址（默认 `https://bb.kyeo.top`），切换服务器会清除令牌并重新登录——适合 fork 部署到自定义域名的实例；
- **数据迁移**：列表右上角 ⬆ 进入迁移页，选择旧 memos 的 `memos.db`，APP 内置解析并调用 `/api/v1/migrate/import` 导入；
- **自动更新**：打 `v*` tag 时 CI 自动构建 release APK 并发布到 GitHub Releases（含 `update.json` 清单）；APP 启动或「设置 → 检查更新」检测新版本并下载安装（fork 用户改 `App.UPDATE_MANIFEST_URL`）。

## 项目结构

```
src/
├── index.ts              # Hono 入口 + /doc + /openapi.json
├── types.ts              # Env 绑定与通用类型
├── db/                   # Drizzle schema + client
├── routes/               # auth / memos / tags / resources / share / ws（P1+ 实现）
└── durable/memo-hub.ts   # 实时推送 DO（P4 实现）
migrations/               # D1 迁移 SQL
docs/
├── PLAN.md               # 总体方案
└── api.md                # API 契约（v1）
scripts/deploy/           # 一键部署基建保障脚本
.github/workflows/        # Deploy workflow
```

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 工程骨架 + API 契约 + 一键部署 | ✅ |
| P1 | 认证 + memo CRUD + 分页 | ✅ |
| P2 | 资源上传（R2） | ✅ |
| P3 | 标签 / 分享 / 搜索增强 | ✅ |
| P4 | 实时推送（WS/SSE）+ 登录限流 | ✅ |
| P5 | Telegram bot | ⏳ |
| P6 | memos 数据迁移（双路径） | ✅ 工具就绪（scripts/migrate/），待真实数据迁移 |
| P7 | Android / 小程序接入 | ⏳ |

## License

MIT

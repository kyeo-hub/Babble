# Babble 使用文档

Babble 是一个基于 **Cloudflare Workers** 的极简笔记服务（memos 复刻）：后端 API + Android APP，支持 Markdown、标签、公开分享、实时推送与自托管。

## 目录

1. [快速开始](#1-快速开始)
2. [后端部署](#2-后端部署)
3. [Android APP](#3-android-app)
4. [数据迁移](#4-数据迁移)
5. [CLI](#5-cli)
6. [浏览器插件（Memos 兼容）](#6-浏览器插件memos-兼容)
7. [API 速查](#7-api-速查)
8. [常见问题](#8-常见问题)

## 1. 快速开始

1. **部署后端**（见 [第 2 节](#2-后端部署)，约 5 分钟）；
2. **登录并发布第一条说说（CLI）**：
   ```bash
   babble login <用户名> <密码>   # 或参照第 6 节用 curl 换 token
   babble "# 你好 Babble"
   ```
3. 也可直接用 REST API / 快捷指令调用（见 [第 6 节](#6-api-速查)）。

> Android APP 已停止迭代（v0.3.5 为最终版，仍可从 [Releases](https://github.com/kyeo-hub/Babble/releases/latest) 下载用于数据迁移）。日常输入推荐 CLI。

## 2. 后端部署

### 一键部署（GitHub Actions）

1. **Fork** 本仓库到你的 GitHub 账号；
2. 在 [Cloudflare](https://dash.cloudflare.com/profile/api-tokens) 创建 API Token（权限：Workers Scripts:Edit、D1:Edit、R2:Edit、KV:Edit、Workers Routes:Edit；Zone 资源选 All zones）；
3. 在仓库 **Settings → Secrets and variables → Actions** 配置：

   | 名称 | 类型 | 说明 |
   |---|---|---|
   | `CLOUDFLARE_API_TOKEN` | Secret | Cloudflare API Token |
   | `CLOUDFLARE_ACCOUNT_ID` | Secret | Cloudflare 账号 ID |
   | `SEED_ADMIN_PASSWORD` | Secret | 首启管理员密码 |
   | `SEED_ADMIN_USERNAME` | Variable | 首启管理员用户名（默认 admin） |
   | `JWT_SECRET` | Secret | JWT 签名密钥（可用 `openssl rand -hex 32` 生成） |

4. **Actions → Deploy to Cloudflare Workers → Run workflow**；
5. 完成后访问 `https://babble.<你的用户名>.workers.dev/api/v1/health`，应返回 `{"ok":true,...}`。

### 自定义域名

在 `wrangler.jsonc` 取消注释 `routes` 并改为你的域名（如 `bb.kyeo.top`，需已托管到 Cloudflare），重新部署即可自动绑定。

### 修改管理员账号

部署后可用 APP「设置 → 修改账号」修改用户名/密码，也可直接调 API：

```bash
curl -X PATCH https://你的域名/api/v1/me \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{"currentPassword":"旧密码","newPassword":"新密码至少8位"}'
```

## 3. Android APP（归档）

> **已停止迭代**：项目方向收敛为「API + CLI 优先」，v0.3.5 为最终版本，不再发布新版。以下功能说明保留给仍在使用 APP 的用户。

### 安装与更新

- 下载：[GitHub Releases](https://github.com/kyeo-hub/Babble/releases/latest) 的 `babble-release.apk`（v0.3.5 最终版）；
- APP 内自动更新不再有新版本推送。

### 登录

打开 APP → 填写「服务器地址」（默认 `https://bb.kyeo.top`；fork 用户填自己部署的域名）→ 用户名/密码登录。

### 功能一览

| 功能 | 位置 |
|---|---|
| memo 列表（Markdown 渲染、标签、置顶标记、分页加载） | 主界面 |
| 下拉刷新 | 列表下拉 |
| 新建 memo | 右下角 ＋ |
| 编辑 memo | 点击卡片 |
| 置顶 / 取消置顶 | 卡片右上角 ⋮ |
| 归档 / 取消归档 | 卡片右上角 ⋮ |
| 删除 memo（二次确认） | 卡片右上角 ⋮ |
| 迁移旧 memos 数据 | 右上角 ⬆ |
| 服务器地址 / 修改账号 / 检查更新 | 右上角 ⚙ |

## 4. 数据迁移

> 两条路径均可：**APP v0.3.5 内置迁移页**（含外部资源补迁，已归档但可继续使用），或下文脚本迁移。CLI 本身不提供解析 memos.db 的迁移功能（SQLite 解析留在 APP 与脚本中）。

### APP 内置迁移（含补迁，v0.3.5）

右上角 ⬆ → 迁移页 → 选择旧 memos 的 `memos.db` → 自动解析（memo 内容 + 本地图片资源）→ 开始导入 → 显示报告。外部存储资源（无 blob）会被跳过并计数。

### 脚本迁移（双路径）

适用于服务端/无头场景，见 [README 迁移章节](../README.md#memos-数据迁移双路径)：`scripts/migrate/` 支持 **SQLite 直转**（读 memos.db）与 **API 拉取**（旧站 token）两种提取方式，导入 D1 并上传 R2，附一致性报告。

### 外部存储资源补迁

当直转/APP 迁移有资源被跳过（无本地 blob，存于磁盘或 S3）时，用补迁工具从旧站 API 提取并增量导入：

1. 在旧 memos「设置 → API」生成 token（建议先轮换），提取全部资源（含外部存储）：

   ```bash
   node scripts/migrate/extract-api.mjs --url https://memos.kyeo.top --token <新token> --resources-only
   # 输出：scripts/migrate/out/backfill-resources.json + out/resources/
   ```

2. 导出新站 uid→id 映射（每行 `id,uid`，保存为 `out/memos-ids.csv`）：

   ```bash
   npx wrangler d1 execute babble --remote --command="SELECT id, uid FROM memos"
   ```

3. 生成增量导入 SQL 与 R2 上传脚本：

   ```bash
   node scripts/migrate/import-resources.mjs --memos out/memos-ids.csv --old-base https://memos.kyeo.top
   # 输出：out/backfill.sql + out/backfill-r2.sh
   ```

4. 应用（需 Cloudflare 凭据）：

   ```bash
   wrangler d1 execute babble --remote --file=scripts/migrate/out/backfill.sql
   bash scripts/migrate/out/backfill-r2.sh
   ```

说明：`INSERT OR IGNORE` 按资源 uid 幂等去重；脚本同时把 memo 内容里的旧图片引用（`/o/r/<uid>`、`/file/<uid>` 及旧站完整 URL）重写为 `/api/v1/resources/<新id>/file`，图片在新站/APP 即可显示。

## 5. CLI

两个版本任选：

- **Go 单文件（推荐，Windows 用户选这个）**：零依赖，从 [Releases](https://github.com/kyeo-hub/Babble/releases) 下载对应平台二进制（tag `cli-v*`）——Windows 下载 `babble_*_windows_amd64.exe` 重命名为 `babble.exe` 放入 PATH 即可；macOS/Linux 下载后 `chmod +x babble` 移入 PATH；
- **bash 脚本**（需 curl + jq）：

```bash
# 安装（一条命令，脚本由你的 Babble 服务器直出，国内友好）
curl -fsSL https://bb.kyeo.top/cli -o babble && sh babble --install
```

用法（两版一致）：

```bash
babble login <用户名> <密码>       # 签发长期 API token，存 ~/.config/babble/config
babble "今天天气不错"              # 快速发布说说
echo "管道内容" | babble post      # stdin 发布
babble list [页码]                 # 列表
babble search <关键词>             # 搜索
babble show <id> / edit <id> "..." / pin <id> / archive <id> / delete <id>
babble upload <文件> [memoId]      # 上传资源
babble server [URL]                # 查看/切换服务器（fork 部署用）
```

环境变量 `BABBLE_SERVER` / `BABBLE_TOKEN` 优先于配置文件，适合 CI/脚本场景。

## 6. 浏览器插件（Memos 兼容）

Babble 内置 **Memos v1 gRPC-Gateway 兼容层**，[Memos Quick Note](https://github.com/chendimao/memos-browers-plugin/) 等按 Memos 官方 API 编写的浏览器插件无需改动即可使用。

### 插件配置

1. 在 Babble 上创建长期 API Token（`POST /api/v1/auth/tokens`，或直接用 CLI/登录接口签发）；
2. 插件设置页填写：
   - **Host URL**：`https://bb.kyeo.top`（fork 用户填自己的域名）；
   - **API Token**：上一步的长期 token；
   - **API 版本**：选 **v0.26**（兼容层按 v1 gRPC-Gateway 形态实现，v0.26 档最接近）；
3. 保存后插件即可：快速记录、标签补全、图片/文件上传、列表查看与编辑。

### 兼容范围

| 能力 | 支持 |
|---|---|
| 创建 / 列表 / 详情 / 编辑 / 删除 memo | ✅ |
| 标签列表（`memos/-/tags`）与按标签过滤 | ✅ |
| 附件上传（`POST /api/v1/attachments`）与下载（`/file/attachments/{uid}/{name}`） | ✅ |
| 会话探测（`auth/sessions/current`，Bearer token） | ✅ |
| 密码会话登录（`POST /auth/sessions`） | ❌ 请用 API Token |
| 评论 / 反应 / 收件箱 / 快捷方式 / SSO | ❌ 未实现 |

> 认证说明：插件只用 `Authorization: Bearer`，兼容层同时接受长期 API Token 与 JWT access token。

## 7. API 速查

```bash
# 登录获取 token
curl -X POST https://你的域名/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"你的密码"}'

# 创建 memo（公开）
curl -X POST https://你的域名/api/v1/memos \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"content":"# 标题\n内容","visibility":"public"}'

# 列出 memo（分页 / 关键字 / 标签过滤）
curl "https://你的域名/api/v1/memos?page=1&page_size=20&keyword=关键字&tag=工作" \
  -H "Authorization: Bearer <token>"

# 生成公开分享短链
curl -X POST https://你的域名/api/v1/memos/<id>/share \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '{}'
```

完整契约见 [docs/api.md](api.md)；线上 Swagger UI：`https://你的域名/doc`。

## 8. 常见问题

**登录返回 401「用户名或密码错误」**：确认用户名/密码正确；连续 5 次失败会触发限流（60 秒内返回 429），等待窗口过后重试。

**登录返回 503「服务未配置 JWT_SECRET」**：部署时未配置 `JWT_SECRET` Secret，配置后重新部署。

**忘记密码**：可重置——删除 D1 中 `users` 表数据后重新登录，会按 `SEED_ADMIN_*` 重建管理员（慎用：会丢失账号自定义信息）。

**APP 提示「检查失败或暂无更新源」**：确认网络可达 GitHub；fork 用户需修改 `App.UPDATE_MANIFEST_URL` 指向自己仓库的 `update.json`。

**反馈与问题上报**：APP 内「报告问题」入口随 APP 归档一并停用（后端 `POST /api/v1/report-issue` 接口保留，仍可调用）。推荐直接在仓库 [New Issue](https://github.com/kyeo-hub/Babble/issues/new) 提交，附上 CLI 报错输出或 API 响应。

**迁移提示跳过外部存储资源**：这些资源文件不在 memos.db 内（存于服务器磁盘/S3），需用脚本的 API 提取路径（`extract-api.mjs`）配合旧站 token 补迁。

**数据备份**：可用 `wrangler d1 export` 导出 D1；资源文件在 R2 桶中（建议定期备份）。

#!/usr/bin/env bash
# 一键迁移：应用 D1 迁移 SQL + 上传 R2 资源 + 输出一致性报告。
# 用法：CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ./scripts/migrate/run-migration.sh
# 前提：已运行提取器与导入器，生成了 out/export.json、out/migrate.sql、out/upload-r2.sh。
# 注意：本脚本操作线上（--remote）D1 与 R2，请先备份/确认目标为空或已用 --id-offset 隔离。
set -euo pipefail
cd "$(dirname "$0")/../.."

# 凭据二选一（同 deploy.sh）：CLOUDFLARE_API_TOKEN 或 wrangler OAuth 登录
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  export CLOUDFLARE_API_TOKEN
else
  echo "WARN: 未设置 CLOUDFLARE_API_TOKEN，将使用 wrangler 已登录的 OAuth 凭据" >&2
fi
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID

OUT="scripts/migrate/out"
[ -f "$OUT/migrate.sql" ] || { echo "缺少 $OUT/migrate.sql，请先运行：extract-*.mjs → import.mjs"; exit 1; }

WRANGLER="./node_modules/.bin/wrangler"
[ -x "$WRANGLER" ] || WRANGLER="npx wrangler"

# 复用部署基建：生成带真实 database_id 的部署配置（d1 execute 按名解析需要）
echo "### 准备部署配置（ensure-infra + build-config）"
infra_out="$(./scripts/deploy/ensure-infra.sh)" || { echo "ERROR: ensure-infra 失败" >&2; exit 1; }
eval "$(printf '%s\n' "$infra_out" | sed 's/^/export /')"
node scripts/deploy/build-config.mjs >/dev/null

echo "=== 1. 应用 D1 迁移（--remote）==="
"$WRANGLER" d1 execute babble --remote --config wrangler.deploy.jsonc --file="$OUT/migrate.sql"

echo "=== 2. 上传 R2 资源 ==="
bash "$OUT/upload-r2.sh"

echo "=== 3. 一致性报告 ==="
node -e '
const fs = require("fs");
const d = JSON.parse(fs.readFileSync("scripts/migrate/out/export.json", "utf8"));
console.log(`源（${d.source.tool}）: ${d.source.memoCount} memos, ${d.source.resourceCount} resources`);
'
"$WRANGLER" d1 execute babble --remote --config wrangler.deploy.jsonc --command="SELECT COUNT(*) AS memo_count FROM memos;"
"$WRANGLER" d1 execute babble --remote --config wrangler.deploy.jsonc --command="SELECT COUNT(*) AS resource_count FROM resources;"
"$WRANGLER" d1 execute babble --remote --config wrangler.deploy.jsonc --command="SELECT id, uid, created_ts FROM memos ORDER BY created_ts DESC LIMIT 3;"
echo "=== 完成：请核对上方计数与抽样时间戳是否与源一致 ==="

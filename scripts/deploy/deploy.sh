#!/usr/bin/env bash
# 一键部署入口（GitHub Actions 与手动部署共用）：
#   1) 确保 D1 / KV / R2 存在（ensure-infra.sh，stdout 仅输出 KEY=VALUE）
#   2) 由 wrangler.jsonc 生成部署配置 wrangler.deploy.jsonc
#   3) 应用 D1 迁移（remote）
#   4) 注入种子管理员密码（wrangler secret put，可选）
#   5) 部署 Worker
set -euo pipefail
cd "$(dirname "$0")/../.."

# 凭据二选一：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID（CI），或 wrangler login 的 OAuth（本地）。
# ensure-infra.sh 会在缺少 token 时打印提示并回退 OAuth。
# 读取 ensure-infra 输出的 KEY=VALUE 并 export（eval 的普通赋值不会传给子进程 node）。
# 先捕获输出并显式检查退出码，避免 eval 吞掉 ensure-infra 的失败。
infra_out="$(./scripts/deploy/ensure-infra.sh)" || { echo "ERROR: ensure-infra 失败" >&2; exit 1; }
eval "$(printf '%s\n' "$infra_out" | sed 's/^/export /')"

node scripts/deploy/build-config.mjs

npx wrangler d1 migrations apply babble --config wrangler.deploy.jsonc --remote

if [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
  printf '%s' "$SEED_ADMIN_PASSWORD" | npx wrangler secret put SEED_ADMIN_PASSWORD --config wrangler.deploy.jsonc
fi

npx wrangler deploy --config wrangler.deploy.jsonc

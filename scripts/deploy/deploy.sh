#!/usr/bin/env bash
# 一键部署入口（GitHub Actions 与手动部署共用）：
#   1) 确保 D1 / KV / R2 存在（ensure-infra.sh，stdout 仅输出 KEY=VALUE）
#   2) 由 wrangler.jsonc 生成部署配置 wrangler.deploy.jsonc
#   3) 应用 D1 迁移（remote）
#   4) 注入种子管理员密码（wrangler secret put，可选）
#   5) 部署 Worker
set -euo pipefail
cd "$(dirname "$0")/../.."

require_env() { : "${!1:?环境变量 $1 未设置（CI 中请配置 secrets.CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）}"; }
require_env CLOUDFLARE_API_TOKEN
require_env CLOUDFLARE_ACCOUNT_ID

eval "$(./scripts/deploy/ensure-infra.sh)"

node scripts/deploy/build-config.mjs

npx wrangler d1 migrations apply babble --config wrangler.deploy.jsonc --remote

if [ -n "${SEED_ADMIN_PASSWORD:-}" ]; then
  printf '%s' "$SEED_ADMIN_PASSWORD" | npx wrangler secret put SEED_ADMIN_PASSWORD --config wrangler.deploy.jsonc
fi

npx wrangler deploy --config wrangler.deploy.jsonc

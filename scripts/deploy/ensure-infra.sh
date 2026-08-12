#!/usr/bin/env bash
# 一键部署基建保障：确保 D1 / KV / R2 存在，并把 id 以 KEY=VALUE 形式输出到 stdout。
# CI 用法：./scripts/deploy/ensure-infra.sh >> "$GITHUB_ENV"
# 本地用法：先设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，再执行本脚本查看输出。
set -euo pipefail

# 凭据二选一：CLOUDFLARE_API_TOKEN（CI）或 wrangler login 的 OAuth（本地）。
# 缺少 token 时回退 OAuth；ACCOUNT_ID 单账号场景可不设。
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  export CLOUDFLARE_API_TOKEN
else
  echo "WARN: 未设置 CLOUDFLARE_API_TOKEN，将使用 wrangler 已登录的 OAuth 凭据" >&2
fi
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID

DB_NAME="${D1_DATABASE_NAME:-babble}"
KV_TITLE="${KV_NAMESPACE_TITLE:-babble-kv}"
BUCKET_NAME="${R2_BUCKET_NAME:-babble-assets}"

# 桶名全局唯一：fork 部署时追加仓库所有者后缀，避免撞名
if [ -n "${GITHUB_REPOSITORY_OWNER:-}" ]; then
  suffix="$(printf '%s' "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
  BUCKET_NAME="${BUCKET_NAME}-${suffix}"
fi

export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# 从 stdin JSON 中取路径值，如：jq_path "database_id" 或 jq_path "data.0.id"
jq_path() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);let r=j;for(const k of process.argv[1].split("."))r=r?.[k];console.log(typeof r==="string"?r:"")}catch{}}) ' "$1"
}

# 从 KV namespace 列表 JSON 中按 title 找 id
kv_id_by_title() {
  KV_TITLE="$KV_TITLE" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const a=Array.isArray(j)?j:[j];const n=a.find(x=>x.title===process.env.KV_TITLE);console.log(n?.id||"")}catch{}})'
}

# 从 R2 bucket 列表 JSON 中按 name 找 name
r2_name_by_title() {
  BUCKET_NAME="$BUCKET_NAME" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const a=Array.isArray(j)?j:[j];const n=a.find(x=>x.name===process.env.BUCKET_NAME);console.log(n?.name||"")}catch{}})'
}

echo "### D1: $DB_NAME" >&2
d1_id="$(npx wrangler d1 info "$DB_NAME" --json 2>/dev/null | jq_path "id")"
if [ -z "$d1_id" ]; then
  d1_id="$(npx wrangler d1 create "$DB_NAME" --json | jq_path "database_id")"
  [ -z "$d1_id" ] && d1_id="$(npx wrangler d1 create "$DB_NAME" --json | jq_path "id")"
fi
[ -n "$d1_id" ] || { echo "ERROR: 无法获取/创建 D1 数据库 $DB_NAME" >&2; exit 1; }
echo "D1_DATABASE_ID=$d1_id"

echo "### KV: $KV_TITLE" >&2
kv_id="$(npx wrangler kv namespace list --json | kv_id_by_title)"
if [ -z "$kv_id" ]; then
  kv_id="$(npx wrangler kv namespace create "$KV_TITLE" --json | jq_path "id")"
fi
kv_preview_id="$(npx wrangler kv namespace list --json | kv_id_by_title)"
if [ -z "$kv_preview_id" ]; then
  kv_preview_id="$(npx wrangler kv namespace create "$KV_TITLE" --preview --json | jq_path "id")"
fi
[ -n "$kv_id" ] || { echo "ERROR: 无法获取/创建 KV namespace $KV_TITLE" >&2; exit 1; }
echo "KV_NAMESPACE_ID=$kv_id"
echo "KV_NAMESPACE_PREVIEW_ID=${kv_preview_id:-$kv_id}"

echo "### R2: $BUCKET_NAME" >&2
existing="$(npx wrangler r2 bucket list --json | r2_name_by_title)"
if [ -z "$existing" ]; then
  npx wrangler r2 bucket create "$BUCKET_NAME" >/dev/null 2>&1 \
    || echo "WARN: R2 桶 $BUCKET_NAME 创建失败（可能全局已存在同名桶），后续步骤按已存在处理"
fi
echo "R2_BUCKET_NAME=$BUCKET_NAME"

echo "### done" >&2

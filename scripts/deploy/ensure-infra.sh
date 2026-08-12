#!/usr/bin/env bash
# 一键部署基建保障：确保 D1 / KV / R2 存在，并把 id 以 KEY=VALUE 形式输出到 stdout。
# CI 用法：./scripts/deploy/ensure-infra.sh
# 本地用法：先设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，再执行本脚本查看输出。
# 注意：wrangler 4.x 仅 d1 list / d1 info 支持 --json，create 类命令需解析其 TOML 输出。
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

# 从 TOML 片段中提取键值，如：toml_value "$out" "database_id"
toml_value() {
  printf '%s' "$1" | grep -oE "$2 = \"[^\"]+\"" | head -1 | grep -oE '"[^"]+"$' | tr -d '"'
}

# 从 d1 info --json 输出中取 id（兼容 id / uuid / database_id 字段）
d1_info_id() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j?.id||j?.uuid||j?.database_id||"")}catch{console.log("")}})'
}

echo "### D1: $DB_NAME" >&2
# d1 info 支持 --json；库不存在时非零退出，|| true 兜底
d1_id="$(npx wrangler d1 info "$DB_NAME" --json 2>/dev/null | d1_info_id)" || true
if [ -z "$d1_id" ]; then
  # d1 create 不支持 --json，解析其 TOML 输出（database_id = "..."）
  d1_create_out="$(npx wrangler d1 create "$DB_NAME" 2>&1 || true)"
  echo "DEBUG: d1 create 输出: ${d1_create_out:-（空）}" >&2
  d1_id="$(toml_value "$d1_create_out" "database_id")" || true
fi
[ -n "$d1_id" ] || { echo "ERROR: 无法获取/创建 D1 数据库 $DB_NAME（请确认 API Token 含 D1:Edit 权限）" >&2; exit 1; }
echo "D1_DATABASE_ID=$d1_id"

echo "### KV: $KV_TITLE" >&2
# kv namespace list 不支持 --json，从表格行中按 title 找 id（行内首个非空单元格）
kv_table_id() {
  npx wrangler kv namespace list 2>/dev/null | grep -F "$KV_TITLE" | head -1 \
    | awk -F'│' '{for(i=1;i<=NF;i++){gsub(/ /,"",$i);if($i!=""){print $i;exit}}}'
}
kv_id="$(kv_table_id)" || true
if [ -z "$kv_id" ]; then
  # kv namespace create 不支持 --json，解析其 TOML 输出（id = "..."）
  kv_create_out="$(npx wrangler kv namespace create "$KV_TITLE" 2>&1 || true)"
  echo "DEBUG: kv create 输出: ${kv_create_out:-（空）}" >&2
  kv_id="$(toml_value "$kv_create_out" "id")" || true
fi
kv_preview_id="$(kv_table_id)" || true
if [ -z "$kv_preview_id" ]; then
  kv_preview_out="$(npx wrangler kv namespace create "$KV_TITLE" --preview 2>&1 || true)"
  echo "DEBUG: kv preview create 输出: ${kv_preview_out:-（空）}" >&2
  kv_preview_id="$(toml_value "$kv_preview_out" "id")" || true
fi
[ -n "$kv_id" ] || { echo "ERROR: 无法获取/创建 KV namespace $KV_TITLE" >&2; exit 1; }
echo "KV_NAMESPACE_ID=$kv_id"
echo "KV_NAMESPACE_PREVIEW_ID=${kv_preview_id:-$kv_id}"

echo "### R2: $BUCKET_NAME" >&2
# R2 绑定只使用桶名（无需 id）：尝试创建，已存在则忽略失败
npx wrangler r2 bucket create "$BUCKET_NAME" >/dev/null 2>&1 || true
echo "R2_BUCKET_NAME=$BUCKET_NAME"

echo "### done" >&2

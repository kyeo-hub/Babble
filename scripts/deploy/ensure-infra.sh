#!/usr/bin/env bash
# 一键部署基建保障：确保 D1 / KV / R2 存在，并把 id 以 KEY=VALUE 形式输出到 stdout。
# CI 用法：./scripts/deploy/ensure-infra.sh
# 本地用法：先设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，再执行本脚本查看输出。
# 注意：
#   - wrangler 4.x 仅 d1 list / d1 info 支持 --json，create 类命令解析其 TOML 输出；
#   - 为避免 CI 下命令替换丢失子进程输出，所有 wrangler 输出一律走临时文件（fd 重定向）。
set -euo pipefail

# 凭据二选一：CLOUDFLARE_API_TOKEN（CI）或 wrangler login 的 OAuth（本地）。
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  export CLOUDFLARE_API_TOKEN
else
  echo "WARN: 未设置 CLOUDFLARE_API_TOKEN，将使用 wrangler 已登录的 OAuth 凭据" >&2
fi
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && export CLOUDFLARE_ACCOUNT_ID

# 直接使用本地 wrangler 二进制（npx 在 CI 下输出捕获不可靠）
WRANGLER="./node_modules/.bin/wrangler"
[ -x "$WRANGLER" ] || WRANGLER="npx wrangler"

DB_NAME="${D1_DATABASE_NAME:-babble}"
KV_TITLE="${KV_NAMESPACE_TITLE:-babble-kv}"
BUCKET_NAME="${R2_BUCKET_NAME:-babble-assets}"

# 桶名全局唯一：fork 部署时追加仓库所有者后缀，避免撞名
if [ -n "${GITHUB_REPOSITORY_OWNER:-}" ]; then
  suffix="$(printf '%s' "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
  BUCKET_NAME="${BUCKET_NAME}-${suffix}"
fi

# 运行 wrangler 命令，stdout+stderr 写入临时文件，回显文件名
wrangler_capture() {
  local f
  f="$(mktemp)"
  "$WRANGLER" "$@" >"$f" 2>&1 || true
  printf '%s' "$f"
}

# 打印临时文件内容到 stderr（诊断用），然后删除
dump_and_rm() {
  local f="$1" label="$2"
  echo "DEBUG: $label:" >&2
  sed 's/^/  /' "$f" >&2
  rm -f "$f"
}

# 从 TOML 片段中提取键值，如：toml_value "$content" "database_id"
toml_value() {
  printf '%s' "$1" | grep -oE "$2 = \"[^\"]+\"" | head -1 | grep -oE '"[^"]+"$' | tr -d '"'
}

# 从 d1 list --json 输出中按 name 找 id（d1 list 的 id 字段为 uuid），stdin 读取
d1_id_by_name() {
  DB_NAME="$DB_NAME" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const a=Array.isArray(j)?j:[j];const n=a.find(x=>x.name===process.env.DB_NAME);console.log(n?.uuid||n?.id||n?.database_id||"")}catch{console.log("")}})'
}

echo "### D1: $DB_NAME" >&2
# 多策略查找 id（全部走临时文件 + 日志打印，便于诊断）：
#   a) d1 list --json 按 name 匹配 uuid
#   b) d1 list 纯表格行（首个非空单元格 = Database ID）
#   c) d1 create TOML（数据库不存在时创建）
d1_id=""
d1_list_f="$(wrangler_capture d1 list --json)"
d1_id="$(d1_id_by_name < "$d1_list_f")" || true
dump_and_rm "$d1_list_f" "d1 list --json 输出"
if [ -z "$d1_id" ]; then
  d1_tbl_f="$(wrangler_capture d1 list)"
  d1_id="$(grep -F "$DB_NAME" "$d1_tbl_f" | head -1 | awk -F'│' '{for(i=1;i<=NF;i++){gsub(/ /,"",$i);if($i!=""){print $i;exit}}}')" || true
  dump_and_rm "$d1_tbl_f" "d1 list 表格输出"
fi
if [ -z "$d1_id" ]; then
  d1_create_f="$(wrangler_capture d1 create "$DB_NAME")"
  d1_id="$(toml_value "$(cat "$d1_create_f")" "database_id")" || true
  dump_and_rm "$d1_create_f" "d1 create 输出"
fi
[ -n "$d1_id" ] || { echo "ERROR: 无法获取/创建 D1 数据库 $DB_NAME（请确认 API Token 含 D1:Edit 权限，详见上方 DEBUG 输出）" >&2; exit 1; }
echo "D1_DATABASE_ID=$d1_id"

echo "### KV: $KV_TITLE" >&2
# kv namespace list 不支持 --json，从表格行中按 title 找 id（行内首个非空单元格）
kv_table_id() {
  "$WRANGLER" kv namespace list 2>/dev/null | grep -F "$KV_TITLE" | head -1 \
    | awk -F'│' '{for(i=1;i<=NF;i++){gsub(/ /,"",$i);if($i!=""){print $i;exit}}}'
}
kv_id="$(kv_table_id)" || true
if [ -z "$kv_id" ]; then
  kv_f="$(wrangler_capture kv namespace create "$KV_TITLE")"
  kv_id="$(toml_value "$(cat "$kv_f")" "id")" || true
  dump_and_rm "$kv_f" "kv create 输出"
  [ -z "$kv_id" ] && kv_id="$(kv_table_id)" || true
fi
kv_preview_id="$(kv_table_id)" || true
if [ -z "$kv_preview_id" ]; then
  kv_pf="$(wrangler_capture kv namespace create "$KV_TITLE" --preview)"
  kv_preview_id="$(toml_value "$(cat "$kv_pf")" "id")" || true
  dump_and_rm "$kv_pf" "kv preview create 输出"
  [ -z "$kv_preview_id" ] && kv_preview_id="$(kv_table_id)" || true
fi
[ -n "$kv_id" ] || { echo "ERROR: 无法获取/创建 KV namespace $KV_TITLE" >&2; exit 1; }
echo "KV_NAMESPACE_ID=$kv_id"
echo "KV_NAMESPACE_PREVIEW_ID=${kv_preview_id:-$kv_id}"

echo "### R2: $BUCKET_NAME" >&2
# R2 绑定只使用桶名（无需 id）：尝试创建，已存在则忽略失败
r2_f="$(wrangler_capture r2 bucket create "$BUCKET_NAME")"
dump_and_rm "$r2_f" "r2 create 输出"
echo "R2_BUCKET_NAME=$BUCKET_NAME"

echo "### done" >&2

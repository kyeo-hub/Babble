#!/usr/bin/env node
/**
 * 导入器：中间 JSON（out/export.json）→ D1 迁移 SQL（out/migrate.sql）+ R2 上传脚本（out/upload-r2.sh）。
 * 用法：node scripts/migrate/import.mjs [--id-offset 10000] [--user-id 1] [--bucket babble-assets]
 * 说明：
 *  - 显式 id（源 id + offset）便于资源 memo_id 引用；目标为全新库时 offset=0 即可，
 *    若目标库已有数据建议用大 offset（如 100000）避免 id 冲突；
 *  - protected 可见性映射为 private（单用户目标无 protected）；
 *  - R2 对象键 = 资源 uid（与新系统上传逻辑一致），由 upload-r2.sh 逐条 put。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureOutDir, readJson, sqlStr, EXPORT_JSON, OUT_DIR } from "./lib/common.mjs";

const args = process.argv.slice(2);
const get = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const idOffset = Number(get("--id-offset", "0"));
const userId = Number(get("--user-id", "1"));
const bucket = get("--bucket", "babble-assets");

const data = readJson(EXPORT_JSON);
const { memos, resources } = data;
if (!Array.isArray(memos) || !Array.isArray(resources)) {
  console.error("export.json 格式不正确（缺少 memos/resources 数组）");
  process.exit(1);
}
ensureOutDir();

const idOf = (srcId) => (srcId == null ? null : Number(srcId) + idOffset);
const visOf = (v) => (v === "protected" ? "private" : v);
const memoTs = new Map(memos.map((m) => [m.srcId, m.createdTs]));

const lines = ["-- 由 scripts/migrate/import.mjs 生成", "BEGIN TRANSACTION;"];
for (const m of memos) {
  lines.push(
    `INSERT INTO memos (id, uid, creator_id, content, visibility, pinned, row_status, created_ts, updated_ts) VALUES (${idOf(m.srcId)}, ${sqlStr(m.uid)}, ${userId}, ${sqlStr(m.content)}, ${sqlStr(visOf(m.visibility))}, ${Number(m.pinned ?? 0)}, ${sqlStr(m.rowStatus ?? "normal")}, ${Number(m.createdTs)}, ${Number(m.updatedTs ?? m.createdTs)});`,
  );
}
for (const r of resources) {
  const ts = Number(r.createdTs ?? memoTs.get(r.srcMemoId) ?? Math.floor(Date.now() / 1000));
  lines.push(
    `INSERT INTO resources (id, uid, memo_id, creator_id, name, type, size, storage_key, created_ts) VALUES (${idOf(r.srcId)}, ${sqlStr(r.uid)}, ${idOf(r.srcMemoId) ?? "NULL"}, ${userId}, ${sqlStr(r.name)}, ${sqlStr(r.type)}, ${Number(r.size ?? 0)}, ${sqlStr(r.uid)}, ${ts});`,
  );
}
lines.push("COMMIT;");
const sqlPath = join(OUT_DIR, "migrate.sql");
writeFileSync(sqlPath, lines.join("\n") + "\n");

// R2 上传脚本
const upLines = [
  "#!/usr/bin/env bash",
  "# 由 scripts/migrate/import.mjs 生成：上传资源文件到 R2（需先设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）",
  "set -euo pipefail",
  'WRANGLER="./node_modules/.bin/wrangler"',
  '[ -x "$WRANGLER" ] || WRANGLER="npx wrangler"',
  `BUCKET="${bucket}"`,
  "",
];
for (const r of resources) {
  upLines.push(`"$WRANGLER" r2 object put "\${BUCKET}/${r.uid}" --file "${r.file}"`);
}
upLines.push("", `echo "R2 资源上传完成：${resources.length} 个"`);
const upPath = join(OUT_DIR, "upload-r2.sh");
writeFileSync(upPath, upLines.join("\n") + "\n");

console.log(`生成：${sqlPath}（${memos.length} memos + ${resources.length} resources，id offset=${idOffset}）`);
console.log(`生成：${upPath}（bucket=${bucket}）`);
console.log("下一步：");
console.log(`  1) wrangler d1 execute babble --remote --file=${sqlPath}`);
console.log(`  2) bash ${upPath}`);

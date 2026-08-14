#!/usr/bin/env node
/**
 * 增量导入器（资源补迁）：
 * 读取 extract-api.mjs --resources-only 生成的 backfill-resources.json，
 * 结合新站 uid→id 映射，生成：
 *   - out/backfill.sql   ：INSERT OR IGNORE resources（uid 幂等去重）+ 内容引用重写 UPDATE
 *   - out/backfill-r2.sh ：R2 上传脚本（对象键 = 资源 uid，与新系统一致）
 *
 * 用法：
 *   node scripts/migrate/import-resources.mjs \
 *       [--backfill out/backfill-resources.json] \
 *       [--memos out/memos-ids.csv] \
 *       [--id-offset 100000] [--old-base https://memos.kyeo.top] [--bucket babble-assets]
 *
 * --memos 文件格式：每行 `id,uid`（新站 memos 表的 id 与 uid；由
 *   `wrangler d1 execute babble --remote --command="SELECT id, uid FROM memos"` 结果整理而来）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureOutDir, readJson, sqlStr, BACKFILL_JSON, OUT_DIR } from "./lib/common.mjs";

const args = process.argv.slice(2);
const get = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const backfillPath = get("--backfill", BACKFILL_JSON);
const memosPath = get("--memos", "");
const idOffset = Number(get("--id-offset", "100000"));
const oldBase = (get("--old-base", "") || "").trim().trimEnd("/");
const bucket = get("--bucket", "babble-assets");

const backfill = readJson(backfillPath);
const { memosMap, resources } = backfill;
if (!Array.isArray(resources) || !Array.isArray(memosMap)) {
  console.error("backfill 文件格式不正确（缺少 resources/memosMap）");
  process.exit(1);
}
ensureOutDir();

// 新站 uid → memo id 映射（每行 id,uid；跳过表头/注释）
const uidToNewId = new Map();
if (memosPath) {
  for (const line of readFileSync(memosPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("id,")) continue;
    const [id, uid] = t.split(",");
    if (id && uid) uidToNewId.set(uid.trim(), Number(id.trim()));
  }
}
console.log(`新站 uid→id 映射：${uidToNewId.size} 条`);

// srcMemoId → 旧 uid → 新 memo id
const srcToUid = new Map(memosMap.map((m) => [m.srcId, m.uid]));

const lines = ["-- 由 scripts/migrate/import-resources.mjs 生成", "BEGIN TRANSACTION;"];
const upLines = [
  "#!/usr/bin/env bash",
  "# 由 scripts/migrate/import-resources.mjs 生成：上传资源文件到 R2",
  "set -euo pipefail",
  'WRANGLER="./node_modules/.bin/wrangler"',
  '[ -x "$WRANGLER" ] || WRANGLER="npx wrangler"',
  `BUCKET="${bucket}"`,
  "",
];

let inserted = 0;
let rewrites = 0;
let unlinked = 0;
let missing = 0;
for (const r of resources) {
  const newId = Number(r.srcId) + idOffset;
  const oldUid = r.srcMemoId != null ? srcToUid.get(Number(r.srcMemoId)) : undefined;
  const newMemoId = oldUid != null ? uidToNewId.get(oldUid) : undefined;
  if (newMemoId == null) unlinked++;
  if (!existsSync(r.file)) {
    console.warn(`跳过资源 #${r.srcId}（${r.name}）：文件缺失 ${r.file}`);
    missing++;
    continue;
  }
  const ts = Number(r.createdTs ?? Math.floor(Date.now() / 1000));
  lines.push(
    `INSERT OR IGNORE INTO resources (id, uid, memo_id, creator_id, name, type, size, storage_key, created_ts) VALUES (${newId}, ${sqlStr(r.uid)}, ${newMemoId ?? "NULL"}, 1, ${sqlStr(r.name)}, ${sqlStr(r.type)}, ${Number(r.size ?? 0)}, ${sqlStr(r.uid)}, ${ts});`,
  );
  inserted++;
  upLines.push(`"$WRANGLER" r2 object put "\${BUCKET}/${r.uid}" --file "${r.file}"`);

  // 内容引用重写：/o/r/<uid>、/file/<uid>（含旧站完整 URL 与相对路径）→ /api/v1/resources/<newId>/file
  if (newMemoId != null && oldUid != null) {
    const newUrl = `/api/v1/resources/${newId}/file`;
    const fromList = [
      ...(oldBase ? [`${oldBase}/o/r/${r.uid}`, `${oldBase}/file/${r.uid}`] : []),
      `/o/r/${r.uid}`,
      `/file/${r.uid}`,
    ];
    let expr = "content";
    for (const from of fromList) {
      expr = `REPLACE(${expr}, ${sqlStr(from)}, ${sqlStr(newUrl)})`;
    }
    lines.push(
      `UPDATE memos SET content = ${expr} WHERE uid = ${sqlStr(oldUid)} AND content LIKE ${sqlStr(`%${r.uid}%`)};`,
    );
    rewrites++;
  }
}
lines.push("COMMIT;");

writeFileSync(join(OUT_DIR, "backfill.sql"), lines.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "backfill-r2.sh"), upLines.join("\n") + "\n");
console.log(`生成 out/backfill.sql：${inserted} 条 INSERT OR IGNORE + ${rewrites} 条引用重写 UPDATE（未关联 ${unlinked}、文件缺失 ${missing}）`);
console.log(`生成 out/backfill-r2.sh：${inserted} 个 R2 上传（bucket=${bucket}）`);
console.log("下一步：");
console.log(`  1) wrangler d1 execute babble --remote --file=scripts/migrate/out/backfill.sql`);
console.log(`  2) bash scripts/migrate/out/backfill-r2.sh`);

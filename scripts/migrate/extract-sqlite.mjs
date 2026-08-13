#!/usr/bin/env node
/**
 * 提取器 A：读取 memos 的 SQLite 数据库（memos.db）→ 中间 JSON（out/export.json）+ 资源文件。
 * 用法：node scripts/migrate/extract-sqlite.mjs <memos.db 路径>
 *
 * 依赖 sql.js（纯 WASM SQLite）读取数据库，无需本机 sqlite3。
 * memos 常见表：memo(id, uid, content, visibility, pinned, row_status, creator_id, created_ts, updated_ts)
 *              resource(id, uid, memo_id, creator_id, filename, blob, type, size, ...)
 * 说明：
 *  - memos 本地存储的资源在 resource.blob（BLOB）字段，直转可直接提取；
 *  - 外部存储（S3 等）资源无 blob，需改用 extract-api.mjs（路径 B）提取。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { ensureOutDir, normalizeTs, writeJson, EXPORT_JSON, RESOURCES_DIR } from "./lib/common.mjs";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("用法: node scripts/migrate/extract-sqlite.mjs <memos.db 路径>");
  process.exit(1);
}

const SQL = await initSqlJs();
const db = new SQL.Database(readFileSync(dbPath));

function queryRows(sql) {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

// 表与列探测（兼容不同 memos 版本）
const tables = queryRows("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
if (!tables.includes("memo")) {
  console.error(`错误：${dbPath} 中未找到 memo 表（现有表：${tables.join(", ") || "无"}）`);
  process.exit(1);
}
console.log(`发现表: ${tables.join(", ")}`);
const memoCols = queryRows("PRAGMA table_info(memo)").map((c) => c.name);
const hasPinned = memoCols.includes("pinned");
const hasRowStatus = memoCols.includes("row_status");
const hasVisibility = memoCols.includes("visibility");
const resourceCols = tables.includes("resource") ? queryRows("PRAGMA table_info(resource)").map((c) => c.name) : [];
const resHasBlob = resourceCols.includes("blob");
const resHasFilename = resourceCols.includes("filename");
const resHasType = resourceCols.includes("type");
const resHasSize = resourceCols.includes("size");
const resHasCreatedTs = resourceCols.includes("created_ts");

// 源管理员用户名（供一致性报告参考）
let adminUsername = null;
if (tables.includes("user")) {
  const users = queryRows("SELECT * FROM user LIMIT 1");
  adminUsername = users[0]?.username ? String(users[0].username) : null;
}

ensureOutDir();

// 提取 memos
const memos = [];
for (const row of queryRows("SELECT * FROM memo ORDER BY id")) {
  let visibility = hasVisibility ? String(row.visibility ?? "PRIVATE").toLowerCase() : "private";
  if (!["public", "protected", "private"].includes(visibility)) visibility = "private";
  memos.push({
    srcId: Number(row.id),
    uid: String(row.uid ?? `src_${row.id}`),
    content: String(row.content ?? ""),
    visibility,
    pinned: hasPinned ? Number(row.pinned ?? 0) : 0,
    rowStatus: hasRowStatus ? String(row.row_status ?? "NORMAL").toLowerCase() : "normal",
    createdTs: normalizeTs(row.created_ts),
    updatedTs: normalizeTs(row.updated_ts),
  });
}

// 提取资源（仅本地 blob 存储；无 blob 字段或为空则跳过，提示走 API 路径）
const resources = [];
if (tables.includes("resource")) {
  for (const row of queryRows("SELECT * FROM resource ORDER BY id")) {
    const blob = resHasBlob ? row.blob : null;
    if (!(blob instanceof Uint8Array) || blob.length === 0) {
      console.warn(`跳过资源 #${row.id}（无本地 blob，可能为外部存储，请改用 extract-api.mjs）`);
      continue;
    }
    const name = resHasFilename ? String(row.filename ?? `resource_${row.id}`) : `resource_${row.id}`;
    const type = resHasType ? String(row.type ?? "application/octet-stream") : "application/octet-stream";
    const size = resHasSize ? Number(row.size ?? blob.length) : blob.length;
    const file = join(RESOURCES_DIR, `res_${row.id}`);
    writeFileSync(file, blob);
    resources.push({
      srcId: Number(row.id),
      srcMemoId: row.memo_id == null ? null : Number(row.memo_id),
      uid: String(row.uid ?? `res_${row.id}`),
      name,
      type,
      size,
      createdTs: resHasCreatedTs ? normalizeTs(row.created_ts) : null,
      file,
    });
  }
}

const exportData = {
  source: {
    tool: "sqlite",
    exportedAt: Math.floor(Date.now() / 1000),
    memoCount: memos.length,
    resourceCount: resources.length,
    adminUsername,
  },
  memos,
  resources,
};
writeJson(EXPORT_JSON, exportData);
console.log(`完成：${memos.length} 条 memo、${resources.length} 个资源 → ${EXPORT_JSON}`);
console.log("提示：protected 可见性导入时会映射为 private；外部存储资源请用 extract-api.mjs。");

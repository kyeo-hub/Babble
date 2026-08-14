/**
 * 迁移工具共享工具库（纯 Node ESM，无第三方运行时依赖）
 *
 * 中间 JSON 格式（统一两种提取路径的输出，见 export.json）：
 * {
 *   "source": { "tool": "sqlite" | "api", "exportedAt": 1786..., "memoCount": 3, "resourceCount": 2 },
 *   "memos": [
 *     { "srcId": 1, "uid": "a1b2c3d4", "content": "...", "visibility": "public"|"private"|"protected",
 *       "pinned": 0|1, "rowStatus": "normal"|"archived", "createdTs": 1690000000, "updatedTs": 1690000000 }
 *   ],
 *   "resources": [
 *     { "srcId": 1, "srcMemoId": 1, "uid": "r1", "name": "a.png", "type": "image/png", "size": 123, "file": "out/resources/r1" }
 *   ]
 * }
 * 说明：
 *  - createdTs/updatedTs 一律归一化为 unix 秒（memos 部分版本存毫秒，>1e12 视为 ms）；
 *  - resources[].file 为提取出的二进制文件路径（sqlite 路径来自 blob 字段，api 路径为下载文件）；
 *  - visibility 原样保留（导入时 protected → private，单用户目标无 protected）。
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DIR = join(MIGRATE_DIR, "out");
export const EXPORT_JSON = join(OUT_DIR, "export.json");
export const BACKFILL_JSON = join(OUT_DIR, "backfill-resources.json");
export const RESOURCES_DIR = join(OUT_DIR, "resources");

/** 时间戳归一化：ms（>1e12）→ 秒；非法值回退当前时间 */
export function normalizeTs(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1000);
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/** SQL 字符串转义（单引号翻倍） */
export function sqlStr(s) {
  return "'" + String(s ?? "").replace(/'/g, "''") + "'";
}

/** 确保输出目录存在 */
export function ensureOutDir() {
  mkdirSync(RESOURCES_DIR, { recursive: true });
}

export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

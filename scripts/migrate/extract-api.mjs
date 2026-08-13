#!/usr/bin/env node
/**
 * 提取器 B：通过 memos API 分页拉取 → 中间 JSON（out/export.json）+ 资源下载。
 * 用法：node scripts/migrate/extract-api.mjs --url https://memos.example.com --token <memos API token>
 * 说明：
 *  - 适用于无法访问服务器文件系统（托管版）或资源为外部存储的场景；
 *  - memos token 在 memos 网页「设置 → API」中生成；
 *  - 资源下载依次尝试多个端点，兼容 memos 0.22+（/api/v1）与旧版（/o/r、/file）。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureOutDir, normalizeTs, writeJson, EXPORT_JSON, RESOURCES_DIR } from "./lib/common.mjs";

const args = process.argv.slice(2);
const urlArg = args[args.indexOf("--url") + 1];
const tokenArg = args[args.indexOf("--token") + 1];
if (!urlArg || !tokenArg) {
  console.error("用法: node scripts/migrate/extract-api.mjs --url <memos 地址> --token <memos API token>");
  process.exit(1);
}
const base = urlArg.replace(/\/+$/, "");

async function apiGet(path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tokenArg}` } });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

// 分页拉取 memos（兼容 {memos:[...]} 与裸数组两种响应形态）
const memos = [];
let page = 1;
const PAGE_SIZE = 100;
for (;;) {
  const data = await apiGet(`/api/v1/memos?page=${page}&page_size=${PAGE_SIZE}`);
  const list = Array.isArray(data) ? data : (data.memos ?? []);
  memos.push(...list);
  const total = Array.isArray(data) ? null : data.total;
  if (list.length < PAGE_SIZE) break;
  if (total != null && memos.length >= Number(total)) break;
  page += 1;
}
console.log(`拉取到 ${memos.length} 条 memo`);

ensureOutDir();

/** 下载资源文件：依次尝试多个端点，返回 Buffer 或 null */
async function downloadResource(id, uid) {
  const candidates = [
    `/api/v1/resources/${id}/blob`,
    `/api/v1/resources/${uid}/blob`,
    `/o/r/${uid}`,
    `/file/${uid}`,
  ];
  for (const path of candidates) {
    try {
      const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${tokenArg}` } });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
    } catch {
      // 尝试下一个端点
    }
  }
  return null;
}

const outMemos = [];
const resources = [];
let resSeq = 0;
for (const m of memos) {
  const visibility = String(m.visibility ?? "PRIVATE").toLowerCase();
  outMemos.push({
    srcId: Number(m.id),
    uid: String(m.uid ?? `api_${m.id}`),
    content: String(m.content ?? ""),
    visibility: ["public", "protected", "private"].includes(visibility) ? visibility : "private",
    pinned: m.pinned ? 1 : 0,
    rowStatus: String(m.rowStatus ?? "NORMAL").toLowerCase(),
    createdTs: normalizeTs(m.createdTs),
    updatedTs: normalizeTs(m.updatedTs),
  });

  for (const r of m.resourceList ?? []) {
    resSeq += 1;
    const buf = await downloadResource(r.id, r.uid);
    if (!buf) {
      console.warn(`下载资源 #${r.id}（${r.name}）失败，跳过`);
      continue;
    }
    const file = join(RESOURCES_DIR, `api_${resSeq}`);
    writeFileSync(file, buf);
    resources.push({
      srcId: Number(r.id),
      srcMemoId: Number(m.id),
      uid: String(r.uid ?? `api_res_${resSeq}`),
      name: String(r.name ?? `resource_${resSeq}`),
      type: String(r.type ?? "application/octet-stream"),
      size: Number(r.size ?? buf.length),
      createdTs: normalizeTs(r.createdTs ?? m.createdTs),
      file,
    });
  }
}

const exportData = {
  source: {
    tool: "api",
    url: base,
    exportedAt: Math.floor(Date.now() / 1000),
    memoCount: outMemos.length,
    resourceCount: resources.length,
  },
  memos: outMemos,
  resources,
};
writeJson(EXPORT_JSON, exportData);
console.log(`完成：${outMemos.length} 条 memo、${resources.length} 个资源 → ${EXPORT_JSON}`);

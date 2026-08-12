#!/usr/bin/env node
/**
 * 生成部署配置 wrangler.deploy.jsonc：
 * 把 wrangler.jsonc 中的 ${ENV_VAR} 占位替换为环境变量实际值，并移除 SEED_ADMIN_PASSWORD
 * （该值走 `wrangler secret put`，不落入部署配置明文）。
 *
 * 注意：wrangler.jsonc 中 SEED_ADMIN_PASSWORD 必须是 vars 的最后一个键（依赖此顺序移除）。
 * 用法：D1_DATABASE_ID=... KV_NAMESPACE_ID=... node scripts/deploy/build-config.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(root, "wrangler.jsonc"), "utf8");

// 部署必需的环境变量缺失时直接报错，避免静默生成空 id 的配置
for (const name of ["D1_DATABASE_ID", "KV_NAMESPACE_ID", "R2_BUCKET_NAME"]) {
  if (!process.env[name]) {
    console.error(`缺少部署必需环境变量 ${name}（请先运行 scripts/deploy/ensure-infra.sh）`);
    process.exit(1);
  }
}

const out = src
  .replace(/\$\{([A-Z0-9_]+)\}/g, (m, name) => process.env[name] ?? "")
  .replace(/,\s*\n\s*"SEED_ADMIN_PASSWORD"\s*:\s*"[^"]*"\s*\n/, "\n");

writeFileSync(join(root, "wrangler.deploy.jsonc"), out);
console.log("wrangler.deploy.jsonc generated");

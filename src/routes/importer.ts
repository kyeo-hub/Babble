import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { AppEnv } from "./auth";
import { authMiddleware } from "../lib/auth";
import { createDb } from "../db/client";
import { memos, resources as resourcesTable } from "../db/schema";
import { genUid } from "../lib/uid";

const MAX_RESOURCES_TOTAL = 50 * 1024 * 1024; // 资源 base64 总量上限（约 37MB 二进制）

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const importReportSchema = z.object({
  batchId: z.string().nullable(),
  importedMemos: z.number(),
  importedResources: z.number(),
  skippedResources: z.number(),
});

// 与 scripts/migrate 的中间格式一致；资源用 memoIndex 引用 memos 数组下标
const importPayloadSchema = z.object({
  batchId: z.string().max(64).optional(),
  memos: z
    .array(
      z.object({
        uid: z.string().max(64).optional(),
        content: z.string(),
        visibility: z.enum(["public", "protected", "private"]).default("private"),
        pinned: z.number().int().default(0),
        rowStatus: z.enum(["normal", "archived"]).default("normal"),
        createdTs: z.number(),
        updatedTs: z.number().optional(),
      }),
    )
    .min(1),
  resources: z
    .array(
      z.object({
        memoIndex: z.number().int().nonnegative().nullable().optional(),
        uid: z.string().max(64).optional(),
        name: z.string(),
        type: z.string(),
        size: z.number().int().nonnegative().optional(),
        dataBase64: z.string().optional(),
      }),
    )
    .default([]),
});

/** base64 → bytes（Worker 环境用 atob） */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function importRoutes(app: OpenAPIHono<AppEnv>): void {
  // use("/migrate") 只匹配精确路径，必须同时注册 "/migrate/*" 才能覆盖 /migrate/import
  app.use("/migrate", authMiddleware);
  app.use("/migrate/*", authMiddleware);

  // POST /migrate/import —— 批量导入 memos（含资源 base64 → R2）
  const importRoute = createRoute({
    method: "post",
    path: "/migrate/import",
    request: {
      body: {
        content: {
          "application/json": { schema: importPayloadSchema },
        },
      },
    },
    responses: {
      201: {
        description: "导入成功（含一致性报告）",
        content: { "application/json": { schema: importReportSchema } },
      },
      400: { description: "输入校验失败/超限", content: { "application/json": { schema: errorSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      409: { description: "batchId 重复（幂等保护）", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(importRoute, async (c) => {
    const body = c.req.valid("json");
    const db = createDb(c.env);
    const userId = c.get("userId");
    const now = Math.floor(Date.now() / 1000);

    // batchId 幂等：重复提交同一批次直接拒绝
    if (body.batchId) {
      const done = await c.env.KV.get(`import:done:${body.batchId}`);
      if (done) {
        return c.json({ error: { code: "CONFLICT", message: "该批次已导入过" } }, 409);
      }
    }

    // 资源总量校验
    const totalBase64 = body.resources.reduce(
      (acc: number, r: { dataBase64?: string }) => acc + (r.dataBase64?.length ?? 0),
      0,
    );
    if (totalBase64 > MAX_RESOURCES_TOTAL) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "资源总量超过 50MB 上限" } }, 400);
    }

    // 显式 id（当前最大 id 顺延），保证资源 memo_id 可引用且整个导入单事务原子
    const maxRow = await db.select({ m: sql<number>`COALESCE(MAX(id), 0)` }).from(memos).get();
    let nextId = Number(maxRow?.m ?? 0) + 1;
    const memoIdByIndex: number[] = [];

    const stmts: BatchItem<"sqlite">[] = [];
    // 幂等：已存在（按 uid）的 memo 直接跳过，避免重复导入触发唯一约束 500
    const existingUids = new Set<string>();
    {
      const uids = body.memos
        .map((m: { uid?: string }) => m.uid)
        .filter((u: string | undefined): u is string => !!u);
      if (uids.length > 0) {
        const rows = await db.select({ uid: memos.uid }).from(memos).where(inArray(memos.uid, uids)).all();
        for (const r of rows) existingUids.add(r.uid);
      }
    }

    let importedMemoCount = 0;
    for (const m of body.memos) {
      if (m.uid && existingUids.has(m.uid)) {
        memoIdByIndex.push(-1); // 已存在：memoId 置空，避免孤儿引用
        continue;
      }
      const id = nextId++;
      memoIdByIndex.push(id);
      importedMemoCount += 1;
      const ts = Math.floor(m.createdTs);
      stmts.push(
        db.insert(memos).values({
          id,
          uid: m.uid ?? genUid(),
          creatorId: userId,
          content: m.content,
          visibility: m.visibility === "protected" ? "private" : m.visibility,
          pinned: m.pinned ?? 0,
          rowStatus: m.rowStatus ?? "normal",
          createdAt: ts,
          updatedAt: Math.floor(m.updatedTs ?? ts),
        }),
      );
    }

    let importedResources = 0;
    let skippedResources = 0;
    for (const r of body.resources) {
      const uid = r.uid ?? genUid();
      const memoId =
        r.memoIndex != null && memoIdByIndex[r.memoIndex] >= 0 ? memoIdByIndex[r.memoIndex] : null;
      let bytes: Uint8Array | null = null;
      if (r.dataBase64) {
        bytes = base64ToBytes(r.dataBase64);
        await c.env.ASSETS.put(uid, bytes, { httpMetadata: { contentType: r.type } });
      }
      if (!bytes || bytes.length === 0) {
        skippedResources += 1;
        continue;
      }
      stmts.push(
        db.insert(resourcesTable)
          .values({
            id: nextId++,
            uid,
            memoId,
            creatorId: userId,
            name: r.name,
            type: r.type,
            size: r.size ?? bytes.length,
            storageKey: uid,
            createdAt: now,
          })
          .onConflictDoNothing(), // 资源 uid 重复时跳过（重导幂等）
      );
      importedResources += 1;
    }

    // memos 已由 zod 保证至少 1 条，batch 运行时非空（类型层经 unknown 断言）
    await db.batch(stmts as unknown as Parameters<typeof db.batch>[0]);

    if (body.batchId) {
      await c.env.KV.put(`import:done:${body.batchId}`, String(Date.now()));
    }

    return c.json(
      {
        batchId: body.batchId ?? null,
        importedMemos: importedMemoCount,
        importedResources,
        skippedResources,
      },
      201,
    );
  });
}

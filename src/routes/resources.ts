import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "./auth";
import { authMiddleware } from "../lib/auth";
import { createDb } from "../db/client";
import { memos, resources } from "../db/schema";
import { genUid } from "../lib/uid";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

/** 按魔数嗅探真实 MIME 类型（避免空/错误 Content-Type 导致资源无法预览） */
function sniffMime(head: Uint8Array): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
    return "image/png";
  if (head.length >= 3 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "image/gif";
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  )
    return "image/webp"; // RIFF....WEBP
  if (head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)
    return "application/pdf";
  if (head.length >= 4 && head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53)
    return "audio/ogg";
  return null;
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "audio/ogg": ".ogg",
};

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const resourceJsonSchema = z.object({
  id: z.number(),
  uid: z.string(),
  memoId: z.number().nullable(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  url: z.string(),
  createdTs: z.number(),
});

export function toResourceJson(r: typeof resources.$inferSelect) {
  return {
    id: r.id,
    uid: r.uid,
    memoId: r.memoId,
    name: r.name,
    type: r.type,
    size: r.size,
    url: `/api/v1/resources/${r.id}/file`,
    createdTs: r.createdAt,
  };
}

export function resourcesRoutes(app: OpenAPIHono<AppEnv>): void {
  app.use("/resources", authMiddleware);
  app.use("/resources/*", authMiddleware);

  // POST /resources/upload —— multipart 上传（字段 file，可选 memoId）
  const uploadRoute = createRoute({
    method: "post",
    path: "/resources/upload",
    responses: {
      201: { description: "上传成功", content: { "application/json": { schema: resourceJsonSchema } } },
      400: { description: "缺少文件或超过 10MB", content: { "application/json": { schema: errorSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "memoId 不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(uploadRoute, async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "缺少文件字段 file" } }, 400);
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "文件超过 10MB 上限" } }, 400);
    }
    const db = createDb(c.env);
    const userId = c.get("userId");

    // 可选 memoId：校验 memo 存在且属于当前用户
    const memoIdRaw = form.get("memoId");
    let memoId: number | null = null;
    if (memoIdRaw) {
      memoId = Number(memoIdRaw);
      if (!Number.isInteger(memoId)) {
        return c.json({ error: { code: "INVALID_ARGUMENT", message: "memoId 无效" } }, 400);
      }
      const memo = await db
        .select()
        .from(memos)
        .where(and(eq(memos.id, memoId), eq(memos.creatorId, userId)))
        .get();
      if (!memo) {
        return c.json({ error: { code: "NOT_FOUND", message: "memo 不存在" } }, 404);
      }
    }

    const uid = genUid();
    // 按魔数嗅探真实 MIME；文件名缺少扩展名时按类型补全（补迁/上传通用）
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const type = sniffMime(head) ?? (file.type || "application/octet-stream");
    let name = file.name || "file";
    if (!/\.[A-Za-z0-9]+$/.test(name) && MIME_EXT[type]) {
      name += MIME_EXT[type];
    }
    await c.env.ASSETS.put(uid, file.stream(), { httpMetadata: { contentType: type } });
    const now = Math.floor(Date.now() / 1000);
    const row = await db
      .insert(resources)
      .values({
        uid,
        memoId,
        creatorId: userId,
        name,
        type,
        size: file.size,
        storageKey: uid,
        createdAt: now,
      })
      .returning()
      .get();
    return c.json(toResourceJson(row), 201);
  });

  // GET /resources/{id}/meta —— 元信息
  const metaRoute = createRoute({
    method: "get",
    path: "/resources/{id}/meta",
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      200: { description: "资源元信息", content: { "application/json": { schema: resourceJsonSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "资源不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(metaRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(c.env);
    const row = await db
      .select()
      .from(resources)
      .where(and(eq(resources.id, id), eq(resources.creatorId, c.get("userId"))))
      .get();
    if (!row) return c.json({ error: { code: "NOT_FOUND", message: "资源不存在" } }, 404);
    return c.json(toResourceJson(row), 200);
  });

  // GET /resources/{id}/file —— 直出文件/图片（Content-Type 为原 mime）
  const fileRoute = createRoute({
    method: "get",
    path: "/resources/{id}/file",
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      200: { description: "文件流（Content-Type 为原 mime）" },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "资源不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(fileRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(c.env);
    const row = await db
      .select()
      .from(resources)
      .where(and(eq(resources.id, id), eq(resources.creatorId, c.get("userId"))))
      .get();
    if (!row) return c.json({ error: { code: "NOT_FOUND", message: "资源不存在" } }, 404);
    const obj = await c.env.ASSETS.get(row.storageKey);
    if (!obj || !obj.body) {
      return c.json({ error: { code: "NOT_FOUND", message: "资源文件缺失" } }, 404);
    }
    return c.body(obj.body, 200, {
      "Content-Type": row.type,
      "Content-Length": String(row.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  // DELETE /resources/{id} —— 删除记录 + R2 对象
  const deleteRoute = createRoute({
    method: "delete",
    path: "/resources/{id}",
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      204: { description: "已删除" },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "资源不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(c.env);
    const row = await db
      .select()
      .from(resources)
      .where(and(eq(resources.id, id), eq(resources.creatorId, c.get("userId"))))
      .get();
    if (!row) return c.json({ error: { code: "NOT_FOUND", message: "资源不存在" } }, 404);
    await c.env.ASSETS.delete(row.storageKey);
    await db.delete(resources).where(eq(resources.id, id)).run();
    return c.body(null, 204);
  });
}

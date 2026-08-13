import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "./auth";
import type { Env } from "../types";
import { createDb } from "../db/client";
import { memos, resources as resourcesTable } from "../db/schema";
import { memoJsonSchema, toMemoJson } from "./memos";
import { genShareCode } from "../lib/uid";

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const shareResponseSchema = z.object({
  shareUrl: z.string().nullable(),
  expiresTs: z.number().nullable(),
});

/** 在 KV 中查找某 memo 的现有分享短码 */
async function findShareCode(env: Env, memoId: number): Promise<{ key: string; code: string } | null> {
  const listed = await env.KV.list({ prefix: "share:" });
  for (const key of listed.keys) {
    const val = await env.KV.get(key.name);
    if (!val) continue;
    try {
      const parsed = JSON.parse(val);
      if (parsed.memoId === memoId) {
        return { key: key.name, code: key.name.slice("share:".length) };
      }
    } catch {
      // 忽略坏值
    }
  }
  return null;
}

/**
 * 分享路由：POST /memos/{id}/share 挂在 api（/api/v1 下，走认证），
 * 公开 GET /p/{code} 挂在 publicApp（主应用，无鉴权）。
 */
export function shareRoutes(api: OpenAPIHono<AppEnv>, publicApp: OpenAPIHono<AppEnv>): void {
  // POST /memos/{id}/share —— 生成/撤销分享短码（仅 public memo，认证由 memos 路由的 /memos/* 中间件覆盖）
  const shareRoute = createRoute({
    method: "post",
    path: "/memos/{id}/share",
    request: {
      params: z.object({ id: z.coerce.number() }),
      body: {
        content: {
          "application/json": { schema: z.object({ revoke: z.boolean().optional() }) },
        },
      },
    },
    responses: {
      200: {
        description: "分享链接（撤销时 shareUrl 为 null）",
        content: { "application/json": { schema: shareResponseSchema } },
      },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      403: { description: "仅 public memo 可分享", content: { "application/json": { schema: errorSchema } } },
      404: { description: "memo 不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  api.openapi(shareRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const origin = new URL(c.req.url).origin;
    const db = createDb(c.env);
    const memo = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, id), eq(memos.creatorId, c.get("userId"))))
      .get();
    if (!memo) return c.json({ error: { code: "NOT_FOUND", message: "memo 不存在" } }, 404);

    // 撤销分享
    if (body.revoke === true) {
      const found = await findShareCode(c.env, memo.id);
      if (found) await c.env.KV.delete(found.key);
      return c.json({ shareUrl: null, expiresTs: null }, 200);
    }

    if (memo.visibility !== "public") {
      return c.json({ error: { code: "FORBIDDEN", message: "仅 public memo 可分享" } }, 403);
    }

    // 已有短码则复用
    const existing = await findShareCode(c.env, memo.id);
    if (existing) {
      return c.json({ shareUrl: `${origin}/p/${existing.code}`, expiresTs: null }, 200);
    }

    // 生成新短码
    const code = genShareCode();
    await c.env.KV.put(
      `share:${code}`,
      JSON.stringify({ memoId: memo.id, memoUid: memo.uid, createdTs: Math.floor(Date.now() / 1000) }),
    );
    return c.json({ shareUrl: `${origin}/p/${code}`, expiresTs: null }, 200);
  });

  // GET /p/{code} —— 公开访问（无鉴权），仅返回 public memo 的 JSON（markdown 原文，渲染由前端完成）
  const publicShareRoute = createRoute({
    method: "get",
    path: "/p/{code}",
    request: { params: z.object({ code: z.string().min(1) }) },
    responses: {
      200: {
        description: "公开 memo JSON",
        content: { "application/json": { schema: memoJsonSchema } },
      },
      404: { description: "短码无效或 memo 非公开", content: { "application/json": { schema: errorSchema } } },
    },
  });
  publicApp.openapi(publicShareRoute, async (c) => {
    const { code } = c.req.valid("param");
    const val = await c.env.KV.get(`share:${code}`);
    if (!val) return c.json({ error: { code: "NOT_FOUND", message: "分享不存在或已撤销" } }, 404);
    let memoUid: string;
    try {
      memoUid = JSON.parse(val).memoUid as string;
    } catch {
      return c.json({ error: { code: "NOT_FOUND", message: "分享数据无效" } }, 404);
    }
    const db = createDb(c.env);
    const memo = await db
      .select()
      .from(memos)
      .where(and(eq(memos.uid, memoUid), eq(memos.visibility, "public")))
      .get();
    if (!memo) return c.json({ error: { code: "NOT_FOUND", message: "memo 不存在或非公开" } }, 404);
    const resRows = await db.select().from(resourcesTable).where(eq(resourcesTable.memoId, memo.id)).all();
    return c.json(toMemoJson(memo, resRows), 200);
  });
}

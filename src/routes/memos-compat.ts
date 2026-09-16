import { Hono } from "hono";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import type { Env } from "../types";
import { createDb } from "../db/client";
import { apiTokens, memos, resources, users } from "../db/schema";
import type { AppEnv } from "./auth";
import { sha256Hex } from "../lib/hash";
import { genUid } from "../lib/uid";

/**
 * Memos v1 gRPC-Gateway 兼容层（供 memos-browers-plugin 等第三方客户端使用）
 * 路径形如 /api/v1/memos、/api/v1/attachments、/file/attachments/...
 * 挂载在主应用（非 /api/v1 子应用）之下、业务路由之前，同名路径优先生效。
 */

type CompatEnv = AppEnv;

/** 兼容层认证：Bearer <JWT> 或 Bearer <长期token>（插件只有 Bearer 一种方式） */
async function compatUserId(c: { req: { header: (k: string) => string | undefined }; env: Env }): Promise<number | null> {
  const auth = c.req.header("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const cred = auth.slice(7).trim();
  const db = createDb(c.env);
  // 1) 先试长期 token（sha256 查表，成本低于 JWT 验签）
  const tokenRow = await db
    .select({ userId: apiTokens.userId })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, await sha256Hex(cred)))
    .get();
  if (tokenRow) return tokenRow.userId;
  // 2) 再试 JWT
  const { verifyJwt } = await import("../lib/jwt");
  const payload = await verifyJwt(cred, c.env.JWT_SECRET);
  if (payload && payload.type === "access") return payload.sub;
  return null;
}

const tsToIso = (sec: number | null | undefined) =>
  sec ? new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") : undefined;

function toCompatMemo(m: typeof memos.$inferSelect, atts: (typeof resources.$inferSelect)[]) {
  return {
    name: `memos/${m.uid}`,
    uid: String(m.id),
    state: m.rowStatus === "archived" ? "ARCHIVED" : "NORMAL",
    creator: `users/${m.creatorId}`,
    creatorUsername: "me",
    createTime: tsToIso(m.createdAt),
    updateTime: tsToIso(m.updatedAt),
    displayTime: tsToIso(m.createdAt),
    content: m.content,
    visibility: m.visibility === "public" ? "PUBLIC" : "PRIVATE",
    tags: [...new Set((m.content.match(/#[^\s#,.\n]+/g) ?? []).map((t) => t.slice(1)))],
    pinned: m.pinned === 1,
    attachments: atts.map(toCompatAttachment),
  };
}

function toCompatAttachment(r: typeof resources.$inferSelect) {
  return {
    name: `attachments/${r.uid}`,
    uid: String(r.id),
    filename: r.name,
    type: r.type,
    size: r.size,
    memo: r.memoId ? `memos/${r.memoId}` : undefined,
    createTime: tsToIso(r.createdAt),
    // 插件拼图片 URL 的依据之一；直连 Babble 资源端点
    externalLink: `/file/attachments/${r.uid}/${encodeURIComponent(r.name)}`,
  };
}

/** 从 memos/{idOrUid} 形式参数解析 memo 行 */
function parseMemoRef(ref: string): string {
  return ref.startsWith("memos/") ? ref.slice(6) : ref;
}

export function memosCompatRoutes(app: Hono<CompatEnv>): void {
  const compat = new Hono<CompatEnv>();

  // CORS：浏览器插件跨域需要（预检 + 实际请求）
  compat.use("*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Origin", c.req.header("origin") ?? "*");
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  });
  compat.options("*", (c) => c.newResponse(null, 204));

  // GET /auth/sessions/current —— 插件启动时探测登录态
  compat.get("/auth/sessions/current", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const user = await createDb(c.env).select().from(users).where(eq(users.id, userId)).get();
    if (!user) return c.json({ error: "unauthenticated" }, 401);
    return c.json({
      user: {
        name: `users/${user.id}`,
        username: user.username,
        role: user.role === "admin" ? "ADMIN" : "USER",
      },
    });
  });
  // POST /auth/sessions —— 插件密码登录（可选支持；返回提示用 accessTokens 更稳）
  compat.post("/auth/sessions", async (c) => {
    const body = await c.req.json<{ passwordCredentials?: { username: string; password: string } }>().catch(() => null);
    if (!body?.passwordCredentials) return c.json({ error: "invalid request" }, 400);
    return c.json(
      { error: "password session not supported; create an API token in Babble and use it as the plugin token" },
      501,
    );
  });

  // GET /memos —— 列表（pageToken 数字偏移；state/orderBy 受限支持）
  compat.get("/memos", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const db = createDb(c.env);
    const pageSize = Math.min(Number(c.req.query("pageSize") ?? c.req.query("page_size") ?? 50) || 50, 200);
    const offset = Number(c.req.query("pageToken") ?? 0) || 0;
    const state = c.req.query("state") ?? "NORMAL";
    const conditions = [eq(memos.creatorId, userId)];
    if (state !== "ALL") conditions.push(eq(memos.rowStatus, state === "ARCHIVED" ? "archived" : "normal"));
    const filter = c.req.query("filter") ?? "";
    const tagMatch = filter.match(/tag\s*==\s*'([^']+)'/);
    if (tagMatch) conditions.push(like(memos.content, `%#${tagMatch[1]}%`));
    const where = and(...conditions);
    const rows = await db
      .select()
      .from(memos)
      .where(where)
      .orderBy(desc(memos.pinned), desc(memos.createdAt))
      .limit(pageSize)
      .offset(offset)
      .all();
    const atts = rows.length
      ? await db.select().from(resources).where(inArray(resources.memoId, rows.map((r) => r.id))).all()
      : [];
    const attMap = new Map<number, (typeof resources.$inferSelect)[]>();
    for (const a of atts) if (a.memoId !== null) (attMap.get(a.memoId) ?? attMap.set(a.memoId, []).get(a.memoId))!.push(a);
    const nextPageToken =
      rows.length === pageSize ? String(offset + pageSize) : undefined;
    return c.json({ memos: rows.map((m) => toCompatMemo(m, attMap.get(m.id) ?? [])), nextPageToken });
  });

  // POST /memos —— 创建
  compat.post("/memos", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const body = await c.req.json<{ content?: string; visibility?: string }>().catch(() => null);
    if (!body?.content) return c.json({ error: "content required" }, 400);
    const db = createDb(c.env);
    const now = Math.floor(Date.now() / 1000);
    const row = await db
      .insert(memos)
      .values({
        uid: genUid(),
        creatorId: userId,
        content: body.content,
        visibility: body.visibility?.toLowerCase() === "public" ? "public" : "private",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json(toCompatMemo(row, []), 200);
  });

  // GET /memos/{ref} —— 详情
  compat.get("/memos/:ref", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const ref = parseMemoRef(c.req.param("ref"));
    const db = createDb(c.env);
    const row = /^\d+$/.test(ref)
      ? await db.select().from(memos).where(and(eq(memos.id, Number(ref)), eq(memos.creatorId, userId))).get()
      : await db.select().from(memos).where(and(eq(memos.uid, ref), eq(memos.creatorId, userId))).get();
    if (!row) return c.json({ error: "not found" }, 404);
    const atts = await db.select().from(resources).where(eq(resources.memoId, row.id)).all();
    return c.json(toCompatMemo(row, atts));
  });

  // PATCH /memos/{ref} —— 更新内容/可见性/置顶
  compat.patch("/memos/:ref", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const ref = parseMemoRef(c.req.param("ref"));
    const body = await c.req
      .json<{ content?: string; visibility?: string; pinned?: boolean; state?: string }>()
      .catch(() => null);
    const db = createDb(c.env);
    const existing = /^\d+$/.test(ref)
      ? await db.select().from(memos).where(and(eq(memos.id, Number(ref)), eq(memos.creatorId, userId))).get()
      : await db.select().from(memos).where(and(eq(memos.uid, ref), eq(memos.creatorId, userId))).get();
    if (!existing) return c.json({ error: "not found" }, 404);
    const patch: Partial<typeof memos.$inferInsert> = { updatedAt: Math.floor(Date.now() / 1000) };
    if (body?.content !== undefined) patch.content = body.content;
    if (body?.visibility !== undefined)
      patch.visibility = body.visibility.toLowerCase() === "public" ? "public" : "private";
    if (body?.pinned !== undefined) patch.pinned = body.pinned ? 1 : 0;
    if (body?.state !== undefined) patch.rowStatus = body.state === "ARCHIVED" ? "archived" : "normal";
    const row = await db.update(memos).set(patch).where(eq(memos.id, existing.id)).returning().get();
    const atts = await db.select().from(resources).where(eq(resources.memoId, existing.id)).all();
    return c.json(toCompatMemo(row, atts));
  });

  // DELETE /memos/{ref}
  compat.delete("/memos/:ref", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const ref = parseMemoRef(c.req.param("ref"));
    const db = createDb(c.env);
    const existing = /^\d+$/.test(ref)
      ? await db.select().from(memos).where(and(eq(memos.id, Number(ref)), eq(memos.creatorId, userId))).get()
      : await db.select().from(memos).where(and(eq(memos.uid, ref), eq(memos.creatorId, userId))).get();
    if (!existing) return c.json({ error: "not found" }, 404);
    await db.delete(memos).where(eq(memos.id, existing.id)).run();
    return c.newResponse(null, 200);
  });

  // GET /memos/-/tags?filter=... 或 /user/stats 用 —— 全部标签及计数
  compat.get("/memos/-/tags", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const db = createDb(c.env);
    const rows = await db
      .select({ content: memos.content })
      .from(memos)
      .where(and(eq(memos.creatorId, userId), eq(memos.rowStatus, "normal")))
      .all();
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const t of r.content.match(/#[^\s#,.\n]+/g) ?? []) {
        const name = t.slice(1);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return c.json({ tags: [...counts.entries()].map(([name, count]) => ({ name, count })) });
  });

  // POST /attachments —— 附件上传（multipart 字段名 file / filename）
  compat.post("/attachments", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file") ?? form?.get("filename");
    if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
    const db = createDb(c.env);
    const uid = genUid();
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    // 复用资源端点的嗅探逻辑（本地简化：无魔数时退回 file.type）
    const sniffed =
      head[0] === 0xff && head[1] === 0xd8 ? "image/jpeg"
      : head[0] === 0x89 && head[1] === 0x50 ? "image/png"
      : head[0] === 0x47 && head[1] === 0x49 ? "image/gif"
      : file.type || "application/octet-stream";
    await c.env.ASSETS.put(uid, file.stream(), { httpMetadata: { contentType: sniffed } });
    const row = await db
      .insert(resources)
      .values({
        uid,
        memoId: null,
        creatorId: userId,
        name: file.name || "file",
        type: sniffed,
        size: file.size,
        storageKey: uid,
        createdAt: Math.floor(Date.now() / 1000),
      })
      .returning()
      .get();
    return c.json(toCompatAttachment(row));
  });

  // GET /file/attachments/{uid}/{filename} —— 附件下载直出
  compat.get("/file/attachments/:uid/:filename", async (c) => {
    const userId = await compatUserId(c);
    if (userId === null) return c.json({ error: "unauthenticated" }, 401);
    const uid = c.req.param("uid");
    const db = createDb(c.env);
    const meta = await db.select().from(resources).where(eq(resources.uid, uid)).get();
    if (!meta) return c.json({ error: "not found" }, 404);
    const obj = await c.env.ASSETS.get(meta.storageKey);
    if (!obj) return c.json({ error: "not found" }, 404);
    return c.newResponse(obj.body, 200, {
      "Content-Type": meta.type,
      "Cache-Control": "private, max-age=3600",
    });
  });

  app.route("/", compat);
}

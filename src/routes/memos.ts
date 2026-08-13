import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, inArray, like, lte, sql } from "drizzle-orm";
import type { AppEnv } from "./auth";
import { authMiddleware } from "../lib/auth";
import { createDb } from "../db/client";
import { memos, resources as resourcesTable } from "../db/schema";
import { resourceJsonSchema, toResourceJson } from "./resources";
import { extractTags } from "../lib/tags";
import { genUid } from "../lib/uid";

const visibilitySchema = z.enum(["public", "private"]);
const rowStatusSchema = z.enum(["normal", "archived"]);

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const memoJsonSchema = z.object({
  id: z.number(),
  uid: z.string(),
  content: z.string(),
  visibility: visibilitySchema,
  pinned: z.boolean(),
  rowStatus: rowStatusSchema,
  tags: z.array(z.string()),
  resources: z.array(resourceJsonSchema),
  createdTs: z.number(),
  updatedTs: z.number(),
});

const memoListSchema = z.object({
  items: z.array(memoJsonSchema),
  page: z.number(),
  page_size: z.number(),
  total: z.number(),
});

const updateMemoSchema = z.object({
  content: z.string().min(1).optional(),
  visibility: visibilitySchema.optional(),
  pinned: z.boolean().optional(),
  rowStatus: rowStatusSchema.optional(),
});

export function toMemoJson(m: typeof memos.$inferSelect, resources: (typeof resourcesTable.$inferSelect)[] = []) {
  return {
    id: m.id,
    uid: m.uid,
    content: m.content,
    visibility: m.visibility,
    pinned: m.pinned === 1,
    rowStatus: m.rowStatus,
    tags: extractTags(m.content), // 由 content 中的 #tag 派生
    resources: resources.map(toResourceJson),
    createdTs: m.createdAt,
    updatedTs: m.updatedAt,
  };
}

/** 解析 memo 标识：纯数字按 id，否则按 uid */
async function findMemo(db: ReturnType<typeof createDb>, userId: number, idParam: string) {
  return /^\d+$/.test(idParam)
    ? db.select().from(memos).where(and(eq(memos.id, Number(idParam)), eq(memos.creatorId, userId))).get()
    : db.select().from(memos).where(and(eq(memos.uid, idParam), eq(memos.creatorId, userId))).get();
}

export function memosRoutes(app: OpenAPIHono<AppEnv>): void {
  // 全部 memo 路由需认证
  app.use("/memos", authMiddleware);
  app.use("/memos/*", authMiddleware);

  // GET /memos —— 列表/过滤/搜索
  const listMemosRoute = createRoute({
    method: "get",
    path: "/memos",
    request: {
      query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        page_size: z.coerce.number().int().min(1).max(100).default(20),
        tag: z.string().optional(),
        visibility: visibilitySchema.optional(),
        archived: z.enum(["true", "false", "all"]).default("false"),
        keyword: z.string().optional(),
        start_ts: z.coerce.number().optional(),
        end_ts: z.coerce.number().optional(),
      }),
    },
    responses: {
      200: { description: "memo 列表", content: { "application/json": { schema: memoListSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(listMemosRoute, async (c) => {
    const q = c.req.valid("query");
    const db = createDb(c.env);
    const conditions = [eq(memos.creatorId, c.get("userId"))];
    if (q.visibility) conditions.push(eq(memos.visibility, q.visibility));
    if (q.archived === "true") conditions.push(eq(memos.rowStatus, "archived"));
    if (q.archived === "false") conditions.push(eq(memos.rowStatus, "normal"));
    if (q.tag) conditions.push(like(memos.content, `%#${q.tag}%`)); // 近似匹配，标签以 # 前缀存储
    if (q.keyword) {
      // 多关键字 AND 分词（SQLite LIKE 对 ASCII 大小写不敏感）
      for (const term of q.keyword.split(/\s+/).filter(Boolean)) {
        conditions.push(like(memos.content, `%${term}%`));
      }
    }
    if (q.start_ts) conditions.push(gte(memos.createdAt, q.start_ts));
    if (q.end_ts) conditions.push(lte(memos.createdAt, q.end_ts));
    const where = and(...conditions);
    const totalRow = await db.select({ n: sql<number>`count(*)` }).from(memos).where(where).get();
    const rows = await db
      .select()
      .from(memos)
      .where(where)
      .orderBy(desc(memos.pinned), desc(memos.createdAt))
      .limit(q.page_size)
      .offset((q.page - 1) * q.page_size)
      .all();
    // 关联资源：一次查询本页所有 memo 的资源并按 memoId 分组
    const resMap = new Map<number, (typeof resourcesTable.$inferSelect)[]>();
    if (rows.length > 0) {
      const resRows = await db
        .select()
        .from(resourcesTable)
        .where(inArray(resourcesTable.memoId, rows.map((r) => r.id)))
        .all();
      for (const r of resRows) {
        if (r.memoId !== null) {
          const list = resMap.get(r.memoId) ?? [];
          list.push(r);
          resMap.set(r.memoId, list);
        }
      }
    }
    return c.json(
      {
        items: rows.map((m) => toMemoJson(m, resMap.get(m.id) ?? [])),
        page: q.page,
        page_size: q.page_size,
        total: totalRow?.n ?? 0,
      },
      200,
    );
  });

  // POST /memos —— 创建
  const createMemoRoute = createRoute({
    method: "post",
    path: "/memos",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ content: z.string().min(1), visibility: visibilitySchema.optional() }),
          },
        },
      },
    },
    responses: {
      201: { description: "创建成功", content: { "application/json": { schema: memoJsonSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(createMemoRoute, async (c) => {
    const { content, visibility } = c.req.valid("json");
    const db = createDb(c.env);
    const now = Math.floor(Date.now() / 1000);
    const row = await db
      .insert(memos)
      .values({
        uid: genUid(),
        creatorId: c.get("userId"),
        content,
        visibility: visibility ?? "private",
        pinned: 0,
        rowStatus: "normal",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return c.json(toMemoJson(row), 201);
  });

  // GET /memos/{id} —— 详情（数字 id 或 uid）
  const getMemoRoute = createRoute({
    method: "get",
    path: "/memos/{id}",
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { description: "memo 详情", content: { "application/json": { schema: memoJsonSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "memo 不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(getMemoRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(c.env);
    const row = await findMemo(db, c.get("userId"), id);
    if (!row) return c.json({ error: { code: "NOT_FOUND", message: "memo 不存在" } }, 404);
    const resRows = await db.select().from(resourcesTable).where(eq(resourcesTable.memoId, row.id)).all();
    return c.json(toMemoJson(row, resRows), 200);
  });

  // PATCH /memos/{id} —— 更新（任意可省字段）
  const updateMemoRoute = createRoute({
    method: "patch",
    path: "/memos/{id}",
    request: {
      params: z.object({ id: z.coerce.number() }),
      body: {
        content: {
          "application/json": { schema: updateMemoSchema },
        },
      },
    },
    responses: {
      200: { description: "更新成功", content: { "application/json": { schema: memoJsonSchema } } },
      400: { description: "未提供任何字段", content: { "application/json": { schema: errorSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "memo 不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(updateMemoRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    if (
      body.content === undefined &&
      body.visibility === undefined &&
      body.pinned === undefined &&
      body.rowStatus === undefined
    ) {
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "至少提供一个字段" } }, 400);
    }
    const db = createDb(c.env);
    const existing = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, id), eq(memos.creatorId, c.get("userId"))))
      .get();
    if (!existing) return c.json({ error: { code: "NOT_FOUND", message: "memo 不存在" } }, 404);
    const updates: Partial<typeof memos.$inferInsert> = { updatedAt: Math.floor(Date.now() / 1000) };
    if (body.content !== undefined) updates.content = body.content;
    if (body.visibility !== undefined) updates.visibility = body.visibility;
    if (body.pinned !== undefined) updates.pinned = body.pinned ? 1 : 0;
    if (body.rowStatus !== undefined) updates.rowStatus = body.rowStatus;
    const row = await db.update(memos).set(updates).where(eq(memos.id, id)).returning().get();
    return c.json(toMemoJson(row), 200);
  });

  // DELETE /memos/{id}
  const deleteMemoRoute = createRoute({
    method: "delete",
    path: "/memos/{id}",
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      204: { description: "已删除" },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "memo 不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(deleteMemoRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(c.env);
    const existing = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, id), eq(memos.creatorId, c.get("userId"))))
      .get();
    if (!existing) return c.json({ error: { code: "NOT_FOUND", message: "memo 不存在" } }, 404);
    // 级联清理关联资源（R2 对象 + 记录），再删 memo（避免外键约束）
    const resRows = await db.select().from(resourcesTable).where(eq(resourcesTable.memoId, id)).all();
    for (const r of resRows) {
      await c.env.ASSETS.delete(r.storageKey);
    }
    await db.delete(resourcesTable).where(eq(resourcesTable.memoId, id)).run();
    await db.delete(memos).where(eq(memos.id, id)).run();
    return c.body(null, 204);
  });

  // POST /memos/{id}/pin —— 置顶切换
  const pinMemoRoute = createRoute({
    method: "post",
    path: "/memos/{id}/pin",
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      200: { description: "翻转后状态", content: { "application/json": { schema: memoJsonSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "memo 不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(pinMemoRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(c.env);
    const existing = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, id), eq(memos.creatorId, c.get("userId"))))
      .get();
    if (!existing) return c.json({ error: { code: "NOT_FOUND", message: "memo 不存在" } }, 404);
    const row = await db
      .update(memos)
      .set({ pinned: existing.pinned === 1 ? 0 : 1, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(memos.id, id))
      .returning()
      .get();
    return c.json(toMemoJson(row), 200);
  });

  // POST /memos/{id}/archive —— 归档切换
  const archiveMemoRoute = createRoute({
    method: "post",
    path: "/memos/{id}/archive",
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      200: { description: "翻转后状态", content: { "application/json": { schema: memoJsonSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "memo 不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(archiveMemoRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(c.env);
    const existing = await db
      .select()
      .from(memos)
      .where(and(eq(memos.id, id), eq(memos.creatorId, c.get("userId"))))
      .get();
    if (!existing) return c.json({ error: { code: "NOT_FOUND", message: "memo 不存在" } }, 404);
    const row = await db
      .update(memos)
      .set({
        rowStatus: existing.rowStatus === "normal" ? "archived" : "normal",
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(memos.id, id))
      .returning()
      .get();
    return c.json(toMemoJson(row), 200);
  });
}

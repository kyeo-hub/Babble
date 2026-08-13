import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import type { AppEnv } from "./auth";
import { authMiddleware } from "../lib/auth";
import { createDb } from "../db/client";
import { memos } from "../db/schema";
import { extractTags } from "../lib/tags";

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const tagListSchema = z.object({
  items: z.array(z.object({ name: z.string(), memoCount: z.number() })),
  total: z.number(),
});

export function tagsRoutes(app: OpenAPIHono<AppEnv>): void {
  app.use("/tags", authMiddleware);

  // GET /tags —— 全部正常 memo 内容的 #tag 派生统计
  const listTagsRoute = createRoute({
    method: "get",
    path: "/tags",
    responses: {
      200: {
        description: "标签列表（按使用次数降序）",
        content: { "application/json": { schema: tagListSchema } },
      },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(listTagsRoute, async (c) => {
    const db = createDb(c.env);
    const rows = await db
      .select({ content: memos.content })
      .from(memos)
      .where(and(eq(memos.creatorId, c.get("userId")), eq(memos.rowStatus, "normal")))
      .all();
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const t of extractTags(r.content)) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const items = [...counts.entries()]
      .map(([name, memoCount]) => ({ name, memoCount }))
      .sort((a, b) => b.memoCount - a.memoCount || a.name.localeCompare(b.name));
    return c.json({ items, total: items.length }, 200);
  });
}

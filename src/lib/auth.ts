import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import type { Env } from "../types";
import { createDb } from "../db/client";
import { apiTokens, users } from "../db/schema";
import { sha256Hex } from "./hash";
import { verifyJwt } from "./jwt";

/** 用类型别名（interface 不满足 Hono Variables 的 Record 约束） */
export type AuthVariables = {
  userId: number;
  user: typeof users.$inferSelect;
};

/**
 * 认证中间件：优先 Authorization: Bearer <jwt>（access 类型），
 * 其次 X-API-Token（长期令牌，sha256 哈希后查表）。
 */
export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const db = createDb(c.env);

  const authHeader = c.req.header("authorization");
  const apiToken = c.req.header("x-api-token");

  let userId: number | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    const payload = await verifyJwt(authHeader.slice(7), c.env.JWT_SECRET);
    if (payload && payload.type === "access") {
      userId = payload.sub;
    }
  } else if (apiToken) {
    const tokenHash = await sha256Hex(apiToken);
    const row = await db
      .select({ userId: apiTokens.userId })
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash))
      .get();
    if (row) {
      userId = row.userId;
      // 更新最近使用时间（尽力而为，失败不影响请求）
      await db
        .update(apiTokens)
        .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
        .where(eq(apiTokens.tokenHash, tokenHash))
        .run()
        .catch(() => {});
    }
  }

  if (userId === null) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "未认证或凭证已失效" } }, 401);
  }

  const user = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "用户不存在" } }, 401);
  }

  c.set("userId", user.id);
  c.set("user", user);
  await next();
});

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";
import type { Env } from "../types";
import { authMiddleware, type AuthVariables } from "../lib/auth";
import { createDb, type Db } from "../db/client";
import { apiTokens, users } from "../db/schema";
import { createPasswordHash, verifyPassword } from "../lib/password";
import { signJwt, verifyJwt } from "../lib/jwt";
import { genToken, genUid } from "../lib/uid";
import { sha256Hex } from "../lib/hash";

export type AppEnv = { Bindings: Env; Variables: AuthVariables };

const ACCESS_TTL = 60 * 60; // 1 小时
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 天
const LOGIN_MAX_ATTEMPTS = 5; // 限流窗口内允许的失败次数
const LOGIN_WINDOW_SECONDS = 60; // 限流窗口（秒）

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const userJsonSchema = z.object({
  id: z.number(),
  uid: z.string(),
  username: z.string(),
  role: z.string(),
  createdTs: z.number(),
});

const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: userJsonSchema,
});

function toUserJson(u: typeof users.$inferSelect) {
  return { id: u.id, uid: u.uid, username: u.username, role: u.role, createdTs: u.createdAt };
}

/** 首启种子管理员：用户表为空且配置了 SEED_ADMIN_* 时创建（幂等） */
async function ensureSeedAdmin(db: Db, env: Env): Promise<void> {
  const row = await db.select({ n: sql<number>`count(*)` }).from(users).get();
  if (row && row.n > 0) return;
  const username = env.SEED_ADMIN_USERNAME;
  const password = env.SEED_ADMIN_PASSWORD;
  if (!username || !password) return;
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(users)
    .values({
      uid: genUid(16),
      username,
      passwordHash: await createPasswordHash(password),
      role: "admin",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function authRoutes(app: OpenAPIHono<AppEnv>): void {
  // ---------- 公共路由 ----------

  // POST /auth/login
  const loginRoute = createRoute({
    method: "post",
    path: "/auth/login",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ username: z.string().min(1), password: z.string().min(1) }),
          },
        },
      },
    },
    responses: {
      200: { description: "登录成功", content: { "application/json": { schema: tokenPairSchema } } },
      401: { description: "用户名或密码错误", content: { "application/json": { schema: errorSchema } } },
      429: { description: "登录尝试过于频繁", content: { "application/json": { schema: errorSchema } } },
      503: { description: "JWT_SECRET 未配置", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(loginRoute, async (c) => {
    if (!c.env.JWT_SECRET) {
      return c.json({ error: { code: "INTERNAL", message: "服务未配置 JWT_SECRET" } }, 503);
    }
    const { username, password } = c.req.valid("json");

    // 登录限流（KV 计数，按 IP+用户名，窗口内最多 LOGIN_MAX_ATTEMPTS 次失败）
    const ip = c.req.header("cf-connecting-ip") ?? "unknown";
    const rlKey = `rl:login:${ip}:${username}`;
    const attempts = Number((await c.env.KV.get(rlKey)) ?? 0);
    if (attempts >= LOGIN_MAX_ATTEMPTS) {
      return c.json({ error: { code: "RATE_LIMITED", message: "登录尝试过于频繁，请稍后再试" } }, 429);
    }

    const db = createDb(c.env);
    await ensureSeedAdmin(db, c.env);
    const user = await db.select().from(users).where(eq(users.username, username)).get();
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await c.env.KV.put(rlKey, String(attempts + 1), { expirationTtl: LOGIN_WINDOW_SECONDS });
      return c.json({ error: { code: "UNAUTHORIZED", message: "用户名或密码错误" } }, 401);
    }
    // 登录成功清除限流计数
    await c.env.KV.delete(rlKey);

    const now = Math.floor(Date.now() / 1000);
    const base = { sub: user.id, iat: now };
    const accessToken = await signJwt({ ...base, type: "access", exp: now + ACCESS_TTL }, c.env.JWT_SECRET);
    const refreshToken = await signJwt({ ...base, type: "refresh", exp: now + REFRESH_TTL }, c.env.JWT_SECRET);
    return c.json({ accessToken, refreshToken, user: toUserJson(user) }, 200);
  });

  // POST /auth/refresh（refresh 轮换）
  const refreshRoute = createRoute({
    method: "post",
    path: "/auth/refresh",
    request: {
      body: {
        content: {
          "application/json": { schema: z.object({ refreshToken: z.string().min(1) }) },
        },
      },
    },
    responses: {
      200: { description: "新 token 对（refresh 轮换）", content: { "application/json": { schema: tokenPairSchema } } },
      401: { description: "刷新令牌无效", content: { "application/json": { schema: errorSchema } } },
      503: { description: "JWT_SECRET 未配置", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(refreshRoute, async (c) => {
    if (!c.env.JWT_SECRET) {
      return c.json({ error: { code: "INTERNAL", message: "服务未配置 JWT_SECRET" } }, 503);
    }
    const { refreshToken } = c.req.valid("json");
    const payload = await verifyJwt(refreshToken, c.env.JWT_SECRET);
    if (!payload || payload.type !== "refresh") {
      return c.json({ error: { code: "UNAUTHORIZED", message: "刷新令牌无效或已过期" } }, 401);
    }
    const db = createDb(c.env);
    const user = await db.select().from(users).where(eq(users.id, payload.sub)).get();
    if (!user) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "用户不存在" } }, 401);
    }
    const now = Math.floor(Date.now() / 1000);
    const base = { sub: user.id, iat: now };
    const accessToken = await signJwt({ ...base, type: "access", exp: now + ACCESS_TTL }, c.env.JWT_SECRET);
    const newRefresh = await signJwt({ ...base, type: "refresh", exp: now + REFRESH_TTL }, c.env.JWT_SECRET);
    return c.json({ accessToken, refreshToken: newRefresh, user: toUserJson(user) }, 200);
  });

  // ---------- 受保护路由（先挂认证中间件） ----------

  // GET /me
  app.use("/me", authMiddleware);
  const meRoute = createRoute({
    method: "get",
    path: "/me",
    responses: {
      200: { description: "当前用户", content: { "application/json": { schema: userJsonSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(meRoute, (c) => c.json(toUserJson(c.get("user")), 200));

  // tokens 相关路由共用认证中间件
  app.use("/auth/tokens", authMiddleware);
  app.use("/auth/tokens/*", authMiddleware);

  // POST /auth/tokens —— 签发长期 API Token（明文仅返回一次）
  const createTokenRoute = createRoute({
    method: "post",
    path: "/auth/tokens",
    request: {
      body: {
        content: {
          "application/json": { schema: z.object({ name: z.string().min(1).max(64) }) },
        },
      },
    },
    responses: {
      201: {
        description: "创建成功（token 明文仅此一次返回）",
        content: {
          "application/json": {
            schema: z.object({ id: z.number(), token: z.string(), name: z.string(), createdTs: z.number() }),
          },
        },
      },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(createTokenRoute, async (c) => {
    const { name } = c.req.valid("json");
    const db = createDb(c.env);
    const token = genToken();
    const now = Math.floor(Date.now() / 1000);
    const row = await db
      .insert(apiTokens)
      .values({ userId: c.get("userId"), tokenHash: await sha256Hex(token), name, createdAt: now })
      .returning()
      .get();
    return c.json({ id: row.id, token, name: row.name, createdTs: row.createdAt }, 201);
  });

  // GET /auth/tokens —— 列出当前用户的令牌
  const listTokensRoute = createRoute({
    method: "get",
    path: "/auth/tokens",
    responses: {
      200: {
        description: "令牌列表",
        content: {
          "application/json": {
            schema: z.object({
              items: z.array(
                z.object({ id: z.number(), name: z.string(), createdTs: z.number(), lastUsedTs: z.number().nullable() }),
              ),
            }),
          },
        },
      },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(listTokensRoute, async (c) => {
    const db = createDb(c.env);
    const rows = await db
      .select({ id: apiTokens.id, name: apiTokens.name, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
      .from(apiTokens)
      .where(eq(apiTokens.userId, c.get("userId")))
      .all();
    return c.json(
      { items: rows.map((r) => ({ id: r.id, name: r.name, createdTs: r.createdAt, lastUsedTs: r.lastUsedAt ?? null })) },
      200,
    );
  });

  // DELETE /auth/tokens/{id} —— 吊销令牌
  const deleteTokenRoute = createRoute({
    method: "delete",
    path: "/auth/tokens/{id}",
    request: { params: z.object({ id: z.coerce.number() }) },
    responses: {
      204: { description: "已吊销" },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      404: { description: "令牌不存在", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(deleteTokenRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = createDb(c.env);
    const res = await db
      .delete(apiTokens)
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, c.get("userId"))))
      .run();
    if (res.meta.changes === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "令牌不存在" } }, 404);
    }
    return c.body(null, 204);
  });

  // register 默认 404：单用户优先，仅通过 SEED_ADMIN_* 种子账号初始化
}

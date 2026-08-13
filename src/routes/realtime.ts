import { OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { AppEnv } from "./auth";
import type { Env } from "../types";
import { createDb } from "../db/client";
import { apiTokens } from "../db/schema";
import { sha256Hex } from "../lib/hash";
import { verifyJwt } from "../lib/jwt";
import { memoHubStub } from "../lib/realtime";

/**
 * WS/SSE 认证：浏览器无法自定义请求头，token 走 query（?token=）或
 * WebSocket 子协议头。支持 JWT（access）与长期 API Token 两种。
 */
async function authenticateRealtime(env: Env, token: string): Promise<number | null> {
  if (!token) return null;
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (payload && payload.type === "access") return payload.sub;
  const db = createDb(env);
  const tokenHash = await sha256Hex(token);
  const row = await db.select({ userId: apiTokens.userId }).from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash)).get();
  return row?.userId ?? null;
}

export function realtimeRoutes(app: OpenAPIHono<AppEnv>): void {
  // GET /ws —— WebSocket 实时推送（?token=<jwt>，认证后转发 DO 完成升级）
  app.get("/ws", async (c) => {
    const url = new URL(c.req.url);
    const token = url.searchParams.get("token") ?? c.req.header("sec-websocket-protocol") ?? "";
    const userId = await authenticateRealtime(c.env, token);
    if (userId === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "未认证" } }, 401);
    }
    return memoHubStub(c.env).fetch(c.req.raw);
  });

  // GET /events —— SSE 实时推送（?token=<jwt>&since=<ts>，since 用于断线补偿）
  app.get("/events", async (c) => {
    const url = new URL(c.req.url);
    const token = url.searchParams.get("token") ?? "";
    const userId = await authenticateRealtime(c.env, token);
    if (userId === null) {
      return c.json({ error: { code: "UNAUTHORIZED", message: "未认证" } }, 401);
    }
    return memoHubStub(c.env).fetch(c.req.raw);
  });
}

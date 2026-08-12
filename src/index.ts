import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import type { Env } from "./types";

const app = new OpenAPIHono<{ Bindings: Env }>();

/** 健康检查（P0 骨架探针） */
app.get("/api/v1/health", (c) => {
  return c.json({
    ok: true,
    service: "babble",
    version: "0.1.0",
    ts: Math.floor(Date.now() / 1000),
  });
});

// OpenAPI 契约：GET /openapi.json + GET /doc（Swagger UI）
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { version: "0.1.0", title: "Babble API" },
});
app.get("/doc", swaggerUI({ url: "/openapi.json" }));

// Durable Object 必须从入口文件导出，wrangler 才能找到
export { MemoHub } from "./durable/memo-hub";

export default app;

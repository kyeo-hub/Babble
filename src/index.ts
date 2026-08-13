import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { authRoutes, type AppEnv } from "./routes/auth";
import { memosRoutes } from "./routes/memos";
import { resourcesRoutes } from "./routes/resources";
import { tagsRoutes } from "./routes/tags";
import { shareRoutes } from "./routes/share";

const app = new OpenAPIHono<AppEnv>();

/** 健康检查 */
app.get("/api/v1/health", (c) => {
  return c.json({
    ok: true,
    service: "babble",
    version: "0.1.0",
    ts: Math.floor(Date.now() / 1000),
  });
});

// 业务路由统一挂在 /api/v1 下
const api = new OpenAPIHono<AppEnv>();
authRoutes(api);
memosRoutes(api);
resourcesRoutes(api);
tagsRoutes(api);
shareRoutes(api, app); // POST share 挂 /api/v1（走认证），公开 /p/:code 挂主应用
app.route("/api/v1", api);

// OpenAPI 契约：GET /openapi.json + GET /doc（Swagger UI）
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { version: "0.1.0", title: "Babble API" },
});
app.get("/doc", swaggerUI({ url: "/openapi.json" }));

// Durable Object 必须从入口文件导出，wrangler 才能找到
export { MemoHub } from "./durable/memo-hub";

export default app;

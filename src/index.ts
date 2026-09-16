import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { authRoutes, type AppEnv } from "./routes/auth";
import { memosRoutes } from "./routes/memos";
import { resourcesRoutes } from "./routes/resources";
import { tagsRoutes } from "./routes/tags";
import { shareRoutes } from "./routes/share";
import { realtimeRoutes } from "./routes/realtime";
import { importRoutes } from "./routes/importer";
import { reportRoutes } from "./routes/report";

const app = new OpenAPIHono<AppEnv>();

/** 全局兜底：任何未处理异常都返回 JSON 错误（不裸 500），消息对用户友好 */
app.onError((err, c) => {
  console.error("unhandled error:", err);
  return c.json(
    { error: { code: "INTERNAL", message: "服务器内部错误，请稍后重试；若持续出现可报告问题" } },
    500,
  );
});

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
realtimeRoutes(api); // /api/v1/ws + /api/v1/events
importRoutes(api); // /api/v1/migrate/import
reportRoutes(api); // /api/v1/report-issue（APP 错误上报 → GitHub Issue）
app.route("/api/v1", api);

// OpenAPI 契约：GET /openapi.json + GET /doc（Swagger UI）
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { version: "0.1.0", title: "Babble API" },
});
app.get("/doc", swaggerUI({ url: "/openapi.json" }));

/**
 * GET /cli —— 一条命令安装 CLI：curl -fsSL https://<域名>/cli | sh
 * 公开路由（不走认证）。脚本内容从 jsDelivr CDN 拉取（国内友好），
 * 失败时回退 raw.githubusercontent.com。
 */
const CLI_SOURCES = [
  "https://cdn.jsdelivr.net/gh/kyeo-hub/Babble@main/scripts/cli/babble",
  "https://raw.githubusercontent.com/kyeo-hub/Babble/main/scripts/cli/babble",
];
app.get("/cli", async (c) => {
  for (const src of CLI_SOURCES) {
    try {
      const resp = await fetch(src, { redirect: "follow", cf: { cacheTtl: 300 } as never });
      if (resp.ok) {
        const text = await resp.text();
        if (text.startsWith("#!")) {
          return c.newResponse(text, 200, {
            "Content-Type": "text/x-shellscript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          });
        }
      }
    } catch {
      // 尝试下一个源
    }
  }
  return c.json(
    { error: { code: "UPSTREAM", message: "CLI 脚本源暂不可用，请从 GitHub 仓库 scripts/cli/babble 手动获取" } },
    502,
  );
});

// Durable Object 必须从入口文件导出，wrangler 才能找到
export { MemoHub } from "./durable/memo-hub";

export default app;

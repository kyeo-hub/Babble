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

/** 根路径主页：服务状态 + CLI 一条命令安装 + 文档入口 */
app.get("/", (c) => {
  const origin = new URL(c.req.url).origin;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Babble — 服务在线</title>
<style>
  :root { --fg:#1e293b; --muted:#64748b; --bg:#f8fafc; --card:#fff; --accent:#fbbf24; --border:#e2e8f0; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; }
  main { max-width:720px; margin:0 auto; padding:48px 20px; }
  h1 { font-size:1.9rem; margin:0 0 4px; }
  .status { color:#16a34a; font-weight:600; }
  .muted { color:var(--muted); font-size:.95rem; }
  pre { background:#0f172a; color:#e2e8f0; border-radius:8px; padding:14px 16px; overflow-x:auto; font-size:.9rem; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:20px 24px; margin:16px 0; }
  a { color:#b45309; }
  ul { padding-left:20px; margin:8px 0; }
</style>
</head>
<body>
<main>
  <h1>📝 Babble <span class="status">● 在线</span></h1>
  <p class="muted">基于 Cloudflare Workers 的极简说说服务 —— API + CLI 优先，全托管零运维。</p>

  <div class="card">
    <h3>⌨️ 一条命令安装 CLI</h3>
    <pre>curl -fsSL ${origin}/cli -o babble &amp;&amp; sh babble --install
babble login &lt;用户名&gt; &lt;密码&gt;
babble "第一条说说"</pre>
    <p class="muted">脚本由本服务直出（jsDelivr 回源），国内可达。</p>
  </div>

  <div class="card">
    <h3>🔌 API 入口</h3>
    <ul>
      <li>健康检查：<a href="${origin}/api/v1/health">/api/v1/health</a></li>
      <li>Swagger UI：<a href="${origin}/doc">/doc</a> · OpenAPI：<a href="${origin}/openapi.json">/openapi.json</a></li>
      <li>契约文档：<a href="https://github.com/kyeo-hub/Babble/blob/main/docs/api.md">docs/api.md</a></li>
    </ul>
  </div>

  <div class="card">
    <h3>📦 更多</h3>
    <ul>
      <li>自部署指南与完整文档：<a href="https://github.com/kyeo-hub/Babble/blob/main/docs/usage.md">docs/usage.md</a></li>
      <li>项目官网：<a href="https://babble-site.pages.dev">babble-site.pages.dev</a></li>
      <li>Android APP（已归档，v0.3.5 最终版）：<a href="https://github.com/kyeo-hub/Babble/releases">Releases</a></li>
    </ul>
  </div>
</main>
</body>
</html>`;
  return c.html(html);
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

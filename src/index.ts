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

/** 根路径主页：服务状态 + CLI 一条命令安装 + 文档入口（实时状态徽标 + 暗色主题） */
app.get("/", (c) => {
  const origin = new URL(c.req.url).origin;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Babble — 服务在线</title>
<style>
  :root {
    --fg:#1e293b; --muted:#64748b; --bg:#f8fafc; --card:#fff; --border:#e2e8f0;
    --accent:#b45309; --code-bg:#0f172a; --code-fg:#e2e8f0; --ok:#16a34a; --bad:#dc2626;
  }
  html.dark {
    --fg:#e2e8f0; --muted:#94a3b8; --bg:#0f172a; --card:#1e293b; --border:#334155;
    --accent:#fbbf24; --code-bg:#020617; --code-fg:#e2e8f0; --ok:#4ade80; --bad:#f87171;
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; transition:background .2s,color .2s; }
  main { max-width:720px; margin:0 auto; padding:48px 20px; }
  h1 { font-size:1.9rem; margin:0 0 4px; }
  h1 .theme-toggle { font-size:.85rem; font-weight:400; cursor:pointer; border:1px solid var(--border); background:var(--card); color:var(--muted); border-radius:8px; padding:4px 12px; margin-left:10px; vertical-align:middle; }
  .badge { display:inline-block; font-size:.85rem; font-weight:600; border-radius:999px; padding:2px 12px; margin-left:10px; vertical-align:middle; background:var(--card); border:1px solid var(--border); color:var(--muted); }
  .badge.ok { color:var(--ok); border-color:var(--ok); }
  .badge.bad { color:var(--bad); border-color:var(--bad); }
  .muted { color:var(--muted); font-size:.95rem; }
  pre { background:var(--code-bg); color:var(--code-fg); border-radius:8px; padding:14px 16px; overflow-x:auto; font-size:.9rem; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:20px 24px; margin:16px 0; }
  a { color:var(--accent); }
  ul { padding-left:20px; margin:8px 0; }
</style>
</head>
<body>
<main>
  <h1>📝 Babble <span class="badge" id="status">状态检测中…</span><span class="theme-toggle" id="theme-toggle" title="切换主题">🌙</span></h1>
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
<script>
  // 主题：localStorage 手动选择优先，否则跟随系统；默认暗色起步
  (function () {
    var root = document.documentElement;
    var saved = localStorage.getItem('babble-theme');
    var dark = saved ? saved === 'dark' : true; // 默认暗色；系统偏好如需跟随可改为 matchMedia 判断
    function apply() { root.classList.toggle('dark', dark); document.getElementById('theme-toggle').textContent = dark ? '☀️' : '🌙'; }
    document.getElementById('theme-toggle').onclick = function () {
      dark = !dark; localStorage.setItem('babble-theme', dark ? 'dark' : 'light'); apply();
    };
    apply();
  })();

  // 实时状态徽标：探测 /api/v1/health，显示在线状态与延迟
  (function () {
    var el = document.getElementById('status');
    var t0 = performance.now();
    fetch('${origin}/api/v1/health', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var ms = Math.round(performance.now() - t0);
        if (d && d.ok) { el.textContent = '● 在线 ' + ms + 'ms'; el.className = 'badge ok'; }
        else { el.textContent = '● 异常响应'; el.className = 'badge bad'; }
      })
      .catch(function () { el.textContent = '● 不可达'; el.className = 'badge bad'; });
  })();
</script>
</body>
</html>`;
  return c.html(html, 200, { "Cache-Control": "no-cache" });
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

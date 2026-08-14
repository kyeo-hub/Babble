import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppEnv } from "./auth";
import { authMiddleware } from "../lib/auth";

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const reportBodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
});

const reportOkSchema = z.object({
  number: z.number(),
  url: z.string(),
});

/**
 * APP 错误上报：POST /api/v1/report-issue → 创建 GitHub Issue。
 * 需要部署时配置 REPORT_REPO（Variable，默认 kyeo-hub/Babble）与
 * REPORT_ISSUE_TOKEN（Secret，Issues:write 的 PAT）。
 */
export function reportRoutes(app: OpenAPIHono<AppEnv>): void {
  app.use("/report-issue", authMiddleware);

  const reportRoute = createRoute({
    method: "post",
    path: "/report-issue",
    request: {
      body: {
        content: { "application/json": { schema: reportBodySchema } },
      },
    },
    responses: {
      201: { description: "已创建 Issue", content: { "application/json": { schema: reportOkSchema } } },
      400: { description: "输入校验失败", content: { "application/json": { schema: errorSchema } } },
      401: { description: "未认证", content: { "application/json": { schema: errorSchema } } },
      501: { description: "未配置 REPORT_ISSUE_TOKEN", content: { "application/json": { schema: errorSchema } } },
      502: { description: "GitHub API 调用失败", content: { "application/json": { schema: errorSchema } } },
    },
  });
  app.openapi(reportRoute, async (c) => {
    const body = c.req.valid("json");
    const repo = c.env.REPORT_REPO || "kyeo-hub/Babble";
    const token = c.env.REPORT_ISSUE_TOKEN;
    if (!token) {
      return c.json(
        { error: { code: "NOT_CONFIGURED", message: "服务未配置 REPORT_ISSUE_TOKEN，无法自动上报" } },
        501,
      );
    }
    const resp = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title: body.title, body: body.body }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return c.json(
        { error: { code: "UPSTREAM", message: `GitHub 上报失败（${resp.status}）：${text.slice(0, 200)}` } },
        502,
      );
    }
    const data = (await resp.json()) as { number?: number; html_url?: string };
    return c.json({ number: data.number ?? 0, url: data.html_url ?? "" }, 201);
  });
}

import { DurableObject } from "cloudflare:workers";

/**
 * P4 实时推送占位（Durable Object）：
 * 后续实现客户端 WS/SSE 连接订阅，与 memo 变更事件广播。
 * 事件负载统一：{ type: "memo.created|updated|deleted|pinned", data: {...} }
 */
export class MemoHub extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return new Response("MemoHub placeholder", { status: 200 });
  }
}

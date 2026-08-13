import { DurableObject } from "cloudflare:workers";

/** 事件缓冲上限（`since` 断线补偿用） */
const EVENT_BUFFER_LIMIT = 50;
/** SSE 心跳间隔（EventSource 默认 30s 重连阈值，注释行保活） */
const SSE_HEARTBEAT_MS = 30_000;

interface HubEvent {
  type: string;
  data: unknown;
  ts: number; // unix 秒
}

interface Client {
  tag: unknown;
  send: (data: string) => void;
  close: () => void;
}

/**
 * 实时推送 Hub（Durable Object）：
 * - WebSocket（Upgrade 请求）与 SSE 两类订阅；
 * - 内存事件缓冲（上限 EVENT_BUFFER_LIMIT），SSE 支持 ?since=<ts> 断线补偿；
 * - Worker 通过 stub.broadcast(type, data) RPC 广播事件。
 *
 * 事件负载（wire 格式，与契约一致）：{ "type": "memo.created|updated|deleted|pinned", "data": {...} }
 */
export class MemoHub extends DurableObject {
  private clients = new Set<Client>();
  private recent: HubEvent[] = [];

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade?.toLowerCase() === "websocket") {
      return this.handleWebSocket();
    }
    return this.handleSse(request);
  }

  /** Worker RPC 入口：广播事件给所有订阅者，并写入缓冲 */
  async broadcast(type: string, data: unknown): Promise<void> {
    const event: HubEvent = { type, data, ts: Math.floor(Date.now() / 1000) };
    this.recent.push(event);
    if (this.recent.length > EVENT_BUFFER_LIMIT) {
      this.recent.splice(0, this.recent.length - EVENT_BUFFER_LIMIT);
    }
    const payload = JSON.stringify({ type: event.type, data: event.data });
    for (const c of [...this.clients]) {
      c.send(payload);
    }
  }

  private handleWebSocket(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const tag = server;
    this.clients.add({
      tag,
      send: (d) => {
        try {
          server.send(d);
        } catch {
          // 连接已关闭
        }
      },
      close: () => {
        try {
          server.close();
        } catch {
          // 已关闭
        }
      },
    });
    // 当前仅服务端推送，忽略客户端消息
    server.addEventListener("message", () => {});
    server.addEventListener("close", () => this.removeByTag(tag));
    server.addEventListener("error", () => this.removeByTag(tag));
    return new Response(null, { status: 101, webSocket: client });
  }

  private handleSse(request: Request): Response {
    const encoder = new TextEncoder();
    const since = Number(new URL(request.url).searchParams.get("since") ?? 0);

    const stream = new ReadableStream({
      start: (controller) => {
        // 断线补偿：先补发 since 之后缓冲中的事件
        for (const e of this.recent) {
          if (e.ts >= since) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: e.type, data: e.data })}\n\n`));
          }
        }
        const client: Client = {
          tag: Symbol("sse"),
          send: (d) => {
            try {
              controller.enqueue(encoder.encode(`data: ${d}\n\n`));
            } catch {
              // 流已关闭
            }
          },
          close: () => {
            try {
              controller.close();
            } catch {
              // 已关闭
            }
          },
        };
        this.clients.add(client);

        // 心跳保活
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            clearInterval(heartbeat);
          }
        }, SSE_HEARTBEAT_MS);

        request.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          this.clients.delete(client);
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  private removeByTag(tag: unknown): void {
    for (const c of this.clients) {
      if (c.tag === tag) {
        this.clients.delete(c);
        break;
      }
    }
  }
}

import type { Env } from "../types";

type MemoHubStub = DurableObjectStub & {
  broadcast: (type: string, data: unknown) => Promise<void>;
};

/** 全局单一 MemoHub 实例（所有订阅与广播共用一个 DO） */
export function memoHubStub(env: Env): MemoHubStub {
  return env.MEMO_HUB.get(env.MEMO_HUB.idFromName("global")) as MemoHubStub;
}

/** 广播 memo 变更事件（内部捕获异常，不影响主流程） */
export async function notifyMemoChange(env: Env, type: string, data: unknown): Promise<void> {
  try {
    await memoHubStub(env).broadcast(type, data);
  } catch {
    // 广播失败（如 DO 暂不可用）不阻断请求
  }
}

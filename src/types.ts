/** Worker 绑定与环境变量（用类型别名而非 interface，以匹配 Hono Bindings 约束） */
export type Env = {
  /** D1 数据库 */
  DB: D1Database;
  /** R2 附件存储 */
  ASSETS: R2Bucket;
  /** KV：JWT 黑名单、登录限流、分享短码 */
  KV: KVNamespace;
  /** 实时推送（WS/SSE 广播） */
  MEMO_HUB: DurableObjectNamespace;
  /** 种子管理员（首启初始化，多用户注册默认关闭） */
  SEED_ADMIN_USERNAME?: string;
  SEED_ADMIN_PASSWORD?: string;
  /** JWT 签名密钥（必填，缺失时认证接口返回 503） */
  JWT_SECRET: string;
  /** Issue 上报：目标仓库（默认 kyeo-hub/Babble；fork 用户改自己的仓库） */
  GITHUB_REPO?: string;
  /** Issue 上报：GitHub PAT（Issues:write，走 wrangler secret put） */
  GITHUB_ISSUE_TOKEN?: string;
}

/** 统一响应结构 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

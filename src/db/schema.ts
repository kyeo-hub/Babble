import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/** 用户表（单用户优先：默认仅种子管理员，多用户后开启注册） */
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uid: text("uid").notNull().unique(),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
    createdAt: integer("created_ts").notNull(), // unix 秒
    updatedAt: integer("updated_ts").notNull(),
  },
  (t) => [index("users_username_idx").on(t.username)],
);

/** 长期 API Token（bot / APP / 小程序用），只存哈希 */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    name: text("name").notNull(),
    createdAt: integer("created_ts").notNull(),
    lastUsedAt: integer("last_used_ts"),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

/**
 * memo 表
 * content 存 markdown 原文，渲染交给各端
 * visibility: public=可被分享链接读取 | private=仅本人（多用户后加 protected）
 * rowStatus: normal | archived
 */
export const memos = sqliteTable(
  "memos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uid: text("uid").notNull().unique(),
    creatorId: integer("creator_id").notNull().references(() => users.id),
    content: text("content").notNull(),
    visibility: text("visibility", { enum: ["public", "private"] }).notNull().default("private"),
    pinned: integer("pinned").notNull().default(0), // 0/1
    rowStatus: text("row_status", { enum: ["normal", "archived"] }).notNull().default("normal"),
    createdAt: integer("created_ts").notNull(),
    updatedAt: integer("updated_ts").notNull(),
  },
  (t) => [
    index("memos_created_idx").on(t.createdAt),
    index("memos_pinned_idx").on(t.pinned),
    index("memos_creator_idx").on(t.creatorId),
  ],
);

/** 标签（P3 起由 memo 内容中的 #tag 派生维护） */
export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    creatorId: integer("creator_id").notNull().references(() => users.id),
    createdAt: integer("created_ts").notNull(),
  },
  (t) => [uniqueIndex("tags_name_creator_idx").on(t.name, t.creatorId)],
);

/** 资源（图片/附件），二进制存 R2，storageKey 对应 R2 对象键 */
export const resources = sqliteTable(
  "resources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uid: text("uid").notNull().unique(),
    memoId: integer("memo_id").references(() => memos.id),
    creatorId: integer("creator_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    type: text("type").notNull(), // mime
    size: integer("size").notNull().default(0),
    storageKey: text("storage_key").notNull().unique(),
    createdAt: integer("created_ts").notNull(),
  },
  (t) => [index("resources_memo_idx").on(t.memoId)],
);

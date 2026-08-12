import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Env } from "../types";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

export function createDb(env: Env): Db {
  return drizzle(env.DB, { schema });
}

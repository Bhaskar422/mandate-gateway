import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:54329/mandate";
// Reuse one pool across Next.js hot reloads.
const g = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
const client = g.__pg ?? (g.__pg = postgres(url, {
  max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 1 : 10)),
  // Pooled connections (PgBouncer, e.g. Neon's "-pooler" host) cannot use prepared statements.
  prepare: !/pooler|pgbouncer/i.test(url),
  onnotice: () => {},
}));
export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

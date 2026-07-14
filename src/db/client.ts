// ─────────────────────────────────────────────────────────────────────────────
// Postgres client (Drizzle + postgres-js). Memoized on globalThis to survive HMR
// and avoid connection storms. Presence of DATABASE_URL selects the real backend.
// ─────────────────────────────────────────────────────────────────────────────
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { hasDb, assertProductionDb } from "./guard";

export { hasDb, assertProductionDb };

type DB = PostgresJsDatabase<typeof schema>;
const KEY = "__artifex_outreach_db__";

export function getDb(): DB {
  const g = globalThis as unknown as Record<string, { db: DB; sql: ReturnType<typeof postgres> } | undefined>;
  if (!g[KEY]) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("getDb() called without DATABASE_URL");
    // Railway proxy + internal both speak TLS-optional; rejectUnauthorized off is
    // safe here because the connection string itself is the secret.
    const sql = postgres(url, {
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
      ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : undefined,
    });
    g[KEY] = { db: drizzle(sql, { schema }), sql };
  }
  return g[KEY]!.db;
}

export async function pingDb(): Promise<boolean> {
  try {
    const g = globalThis as unknown as Record<string, { sql: ReturnType<typeof postgres> } | undefined>;
    getDb();
    await g[KEY]!.sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

export { schema };

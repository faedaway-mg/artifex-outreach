#!/usr/bin/env node
// Content Studio schema migrator — applies the deploy/content_studio_*.sql files IN ORDER, idempotently,
// against CS_DATABASE_URL || DATABASE_URL. Every file uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards
// (see each file's header for its documented ROLLBACK), so re-running is safe. Use as a one-off before
// deploying the web/worker (Railway: `railway run node scripts/cs-migrate.mjs`), or locally over a proxy.
// Bytes live in content_studio_artifacts; this creates the durable job/upload/approval/posted/share
// lifecycle tables so web enqueue and worker claim share the SAME records (no filesystem, no /tmp).
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORDER = [
  "content_studio_artifacts.sql",        // bytes (may already exist)
  "field_note_jobs.sql",                 // content_studio_jobs base
  "content_studio_jobs_lifecycle.sql",   // + RenderJob columns
  "content_studio_shares.sql",           // shares + email drafts base
  "content_studio_shares_lifecycle.sql", // + ShareRecord display columns
  "content_studio_uploads.sql",
  "content_studio_approvals.sql",
  "content_studio_posted.sql",
  "content_studio_templates.sql",
  "content_studio_drafts.sql",
];

const url = process.env.CS_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("cs-migrate: CS_DATABASE_URL/DATABASE_URL required"); process.exit(1); }
const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
const sql = postgres(url, { max: 1, prepare: false, ssl });

try {
  for (const file of ORDER) {
    const ddl = readFileSync(join(ROOT, "deploy", file), "utf8");
    await sql.unsafe(ddl); // whole-file DDL; each statement is idempotently guarded
    console.log(`  ✓ applied ${file}`);
  }
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'content_studio%' ORDER BY 1`;
  console.log("content_studio tables:", tables.map((t) => t.tablename).join(", "));
  console.log("cs-migrate: complete.");
} catch (e) {
  console.error("cs-migrate FAILED:", e?.message || e);
  process.exitCode = 1;
} finally {
  await sql.end();
}

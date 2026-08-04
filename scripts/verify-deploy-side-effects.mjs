// READ-ONLY: did this deployment write anything? Counts rows created since a
// cutoff across the tables a send / an outcome / an ownership change would touch.
// SELECT only. Never prints DATABASE_URL.
//   node scripts/verify-deploy-side-effects.mjs '2026-08-04T04:55:00Z'
import fs from "fs";
import path from "path";

function loadDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const f = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(f)) return "";
  for (const raw of fs.readFileSync(f, "utf8").split("\n")) {
    const t = raw.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (t.slice(0, i).trim() === "DATABASE_URL") return t.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  return "";
}

const cutoff = process.argv[2];
const url = loadDbUrl();
const postgres = (await import(path.resolve(process.cwd(), "node_modules/postgres/src/index.js"))).default;
const sql = postgres(url, { max: 1, prepare: false, ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : "require" });

const checks = [
  ["emails sent", "email_sends", "created_at"],
  ["email events", "email_events", "received_at"],
  ["call/outreach outcomes", "outreach", "created_at"],
  ["tasks", "tasks", "created_at"],
  ["audit log entries (ownership/role changes)", "audit_log", "created_at"],
  ["leads created", "leads", "created_at"],
  ["leads updated", "leads", "updated_at"],
];

try {
  for (const [label, table, col] of checks) {
    try {
      const r = await sql.unsafe(`select count(*)::int c from ${table} where ${col} > $1`, [cutoff]);
      console.log(`  ${label.padEnd(44)} ${r[0].c}`);
    } catch (e) {
      console.log(`  ${label.padEnd(44)} UNKNOWN (${String(e.message).slice(0, 40)})`);
    }
  }
} finally {
  await sql.end();
}

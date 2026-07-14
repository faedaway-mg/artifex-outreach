/**
 * Clears business/prospect data from the database (leads, contacts, findings,
 * screenshots, deliverables, videos, outreach, tasks, meetings, proposals,
 * suppressions). Keeps settings, users, and the audit log. Use to make a freshly
 * seeded database pristine for real production use.
 */
import "./loadEnv";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL — nothing to clear (mock mode).");
    return;
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: process.env.DATABASE_URL.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : undefined });
  const tables = ["proposals", "meetings", "tasks", "outreach", "videos", "deliverables", "screenshots", "findings", "contacts", "suppressions", "leads"];
  for (const t of tables) {
    await sql.unsafe(`DELETE FROM ${t}`);
    console.log(`cleared ${t}`);
  }
  await sql.end();
  console.log("✓ Business data cleared (settings, users, audit_log retained).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

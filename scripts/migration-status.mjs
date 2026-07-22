// Migration status + smoke-test id helper (used by deploy-production.sh).
//   node scripts/migration-status.mjs --count       -> prints # of pending migrations
//   node scripts/migration-status.mjs --sample-ids  -> prints "<leadId> <deliverableId>"
// Reads DATABASE_URL from the environment or .env.local. Never prints the URL.
import fs from "fs";
import path from "path";

function loadDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const f = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(f)) {
    for (const raw of fs.readFileSync(f, "utf8").split("\n")) {
      const t = raw.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (t.slice(0, i).trim() === "DATABASE_URL") return t.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  }
  return "";
}

async function main() {
  const mode = process.argv.includes("--sample-ids") ? "ids" : "count";
  const url = loadDbUrl();
  if (!url) { if (mode === "count") console.log("ERR"); process.exit(mode === "count" ? 0 : 0); return; }
  const postgres = (await import(path.resolve(process.cwd(), "node_modules/postgres/src/index.js"))).default;
  const ssl = url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : "require";
  const sql = postgres(url, { max: 1, prepare: false, ssl });
  try {
    if (mode === "count") {
      const journal = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
      const total = journal.entries.length;
      const applied = (await sql`select count(*)::int c from drizzle.__drizzle_migrations`)[0].c;
      console.log(Math.max(0, total - applied));
    } else {
      const lead = await sql`select id from leads where coalesce(industry,'') not ilike '%internal%' order by created_at limit 1`;
      const deliv = await sql`select id from deliverables order by created_at limit 1`;
      console.log(`${lead[0]?.id ?? ""} ${deliv[0]?.id ?? ""}`.trim());
    }
  } catch (e) {
    if (mode === "count") console.log("ERR");
  } finally {
    await sql.end();
  }
}
main();

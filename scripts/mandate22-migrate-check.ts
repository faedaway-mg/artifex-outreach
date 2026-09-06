// MANDATE 22 — read-only check of prod migration state before applying the additive enum change.
// Reports: whether 'Rejected' is already an enum value, whether drizzle's __drizzle_migrations table exists,
// and how many migrations it has recorded. Writes NOTHING.
export {}; // make this a module so its top-level `main` doesn't collide with other scripts under tsc
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log("no DATABASE_URL"); return; }
  const postgres = (await import("postgres")).default;
  const ssl = url.includes("proxy.rlwy.net") || url.includes("rlwy.net") ? { rejectUnauthorized: false } : undefined;
  const sql = postgres(url, { max: 1, prepare: false, ssl });
  const enumVals = await sql`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'pipeline_stage' ORDER BY e.enumsortorder`;
  const hasRejected = enumVals.some((r: any) => r.enumlabel === "Rejected");
  const migTable = await sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS d, to_regclass('public.__drizzle_migrations') AS p`;
  let migCount: number | string = "n/a";
  const tbl = migTable[0].d || migTable[0].p;
  if (tbl) { try { const c = await sql.unsafe(`SELECT count(*)::int AS n FROM ${tbl}`); migCount = c[0].n; } catch (e) { migCount = `err:${(e as Error).message}`; } }
  console.log(JSON.stringify({ enumValues: enumVals.map((r: any) => r.enumlabel), hasRejected, drizzleMigrationsTable: tbl, migCount }, null, 2));
  await sql.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

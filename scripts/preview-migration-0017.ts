// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY preview of migration 0017 against the production database.
// Runs only SELECTs against catalog + counts. Writes nothing. Prints no secrets.
//   railway run --service Postgres -- ./node_modules/.bin/tsx scripts/preview-migration-0017.ts
// ─────────────────────────────────────────────────────────────────────────────
import "./loadEnv";

if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

async function main() {
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL!;
  const ssl = url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : ("require" as const);
  const sql = postgres(url, { max: 1, prepare: false, ssl });

  try {
    const cols = await sql`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_name = 'tasks' and column_name in ('source_plan_id','source_step_id')`;
    const idx = await sql`
      select indexname from pg_indexes
      where tablename = 'tasks' and indexname = 'tasks_source_step_idx'`;
    const [{ c: taskCount }] = await sql`select count(*)::int c from tasks`;
    const [{ c: applied }] = await sql`select count(*)::int c from drizzle.__drizzle_migrations`;

    console.log("\n== PRODUCTION STATE BEFORE 0017 (read-only) ==");
    console.log(`migrations applied .............. ${applied}`);
    console.log(`rows in tasks ................... ${taskCount}`);
    console.log(`source_* columns present ........ ${cols.length ? cols.map((c: any) => c.column_name).join(", ") : "none (as expected)"}`);
    console.log(`tasks_source_step_idx present ... ${idx.length ? "yes" : "no (as expected)"}`);

    console.log("\n== WHAT 0017 WILL DO ==");
    console.log("  1. ALTER TABLE tasks ADD COLUMN source_plan_id text   -- nullable, no default");
    console.log("  2. ALTER TABLE tasks ADD COLUMN source_step_id text   -- nullable, no default");
    console.log("  3. CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_step_idx ON tasks (source_step_id)");
    console.log(`\n  Additive only. No column is dropped, renamed, or retyped. No row is rewritten.`);
    console.log(`  All ${taskCount} existing rows get NULL in both columns; Postgres treats NULLs as`);
    console.log(`  distinct, so the unique index cannot collide on them.`);

    // Prove the unique index cannot fail on existing data.
    const dupes = cols.length
      ? await sql`select source_step_id, count(*)::int c from tasks
                  where source_step_id is not null group by 1 having count(*) > 1`
      : [];
    console.log(`  Existing values that would violate the unique index: ${dupes.length}`);

    console.log("\n  Reversal: DROP INDEX tasks_source_step_idx; ALTER TABLE tasks DROP COLUMN ...");
    console.log("  (no data loss, since nothing populates these columns until the new code runs)");
    console.log("\nrows written by this script: 0");
  } finally {
    await sql.end();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

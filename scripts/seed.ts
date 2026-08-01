/**
 * Development seed. Populates the sample dataset.
 *
 *   • No DATABASE_URL → mock mode; the dev server seeds in memory on boot. This
 *     script just prints the dataset summary.
 *   • DATABASE_URL present → inserts the sample rows into Postgres FOR DEVELOPMENT.
 *
 * Refuses to run against a production database unless FORCE_SEED=1 is set, so we
 * never seed fake prospects into production automatically.
 */
import "./loadEnv";
import { db as buildStore } from "../src/lib/store";

async function main() {
  const store = buildStore(); // triggers in-memory seed
  const summary = {
    operators: store.operators.length,
    leads: store.leads.length,
    contacts: store.contacts.length,
    findings: store.findings.length,
    screenshots: store.screenshots.length,
    deliverables: store.deliverables.length,
    videos: store.videos.length,
    outreach: store.outreach.length,
    tasks: store.tasks.length,
    meetings: store.meetings.length,
    proposals: store.proposals.length,
    suppressions: store.suppressions.length,
  };

  if (!process.env.DATABASE_URL) {
    console.log("✓ Mock seed dataset built (in-memory):");
    for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(14)} ${v}`);
    console.log("\nNo DATABASE_URL — dev server seeds this same data on boot.");
    return;
  }

  if (process.env.NODE_ENV === "production" && process.env.FORCE_SEED !== "1") {
    console.error("Refusing to seed a production database. Set FORCE_SEED=1 to override (not recommended).");
    process.exit(1);
  }

  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const schema = await import("../src/db/schema");
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl: process.env.DATABASE_URL.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : undefined });
  const dbi = drizzle(sql, { schema });

  const existing = await dbi.select().from(schema.leads);
  if (existing.length > 0 && process.env.FORCE_SEED !== "1") {
    console.log(`Database already has ${existing.length} leads — skipping seed. Set FORCE_SEED=1 to reseed.`);
    await sql.end();
    return;
  }

  console.log("Seeding Postgres (development)…");
  const insert = async (table: any, rows: any[]) => {
    if (rows.length) await dbi.insert(table).values(rows);
  };
  await insert(schema.operators, store.operators);
  await insert(schema.leads, store.leads);
  await insert(schema.contacts, store.contacts);
  await insert(schema.findings, store.findings);
  await insert(schema.screenshots, store.screenshots);
  await insert(schema.deliverables, store.deliverables);
  await insert(schema.videos, store.videos);
  await insert(schema.outreach, store.outreach);
  await insert(schema.tasks, store.tasks);
  await insert(schema.meetings, store.meetings);
  await insert(schema.proposals, store.proposals);
  await insert(schema.suppressions, store.suppressions);
  await dbi
    .insert(schema.settings)
    .values({ id: "singleton", data: store.settings as any, updatedAt: new Date().toISOString() })
    .onConflictDoNothing();

  console.log("✓ Seeded Postgres:");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(14)} ${v}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

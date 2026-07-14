/**
 * Migration runner. Applies Drizzle migrations to Postgres when DATABASE_URL is
 * set; otherwise a no-op (mock mode uses the in-memory store).
 */
import "./loadEnv";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL — mock mode, no migrations to run.");
    return;
  }
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");

  const ssl = process.env.DATABASE_URL.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : undefined;
  const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, ssl });
  const dbi = drizzle(sql);
  await migrate(dbi, { migrationsFolder: "./drizzle" });
  await sql.end();
  console.log("✓ Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Idempotent backfill: assigns normalized_category + category_group to existing
 * leads based on their industry. Changes ONLY those two columns — scores, stages,
 * tasks, Place IDs, sources, run reports are untouched. Safe to run repeatedly.
 */
import "./loadEnv";
import { categoryMetaForIndustry } from "../src/lib/categories";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("No DATABASE_URL — nothing to backfill.");
    return;
  }
  const postgres = (await import("postgres")).default;
  const url = process.env.DATABASE_URL;
  const sql = postgres(url, { max: 1, prepare: false, ssl: url.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : undefined });

  const leads = await sql`select id, industry, normalized_category from leads`;
  let updated = 0;
  for (const l of leads) {
    const meta = categoryMetaForIndustry(l.industry);
    await sql`update leads set normalized_category = ${meta.normalizedCategory}, category_group = ${meta.group} where id = ${l.id}`;
    updated += 1;
  }
  const check = await sql`select category_group, count(*)::int c from leads group by category_group order by c desc`;
  console.log(`✓ Backfilled ${updated} leads.`);
  console.log("  by group:", check.map((r) => `${r.category_group}=${r.c}`).join(", "));
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * READ-ONLY post-migration verification for 0019 + 0020. Proves the BI read path
 * no longer throws on surface_package, existing rows are intact and nullable, and
 * the review_video_jobs table exists. No writes.
 */
import "./loadEnv";
import { allBusinessIntelligence, listLeads, allReviewVideoJobs } from "../src/lib/repo";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set — refusing to run.");

  // 1) allBusinessIntelligence() previously threw "column surface_package does not exist".
  const bi = await allBusinessIntelligence();
  const withSurface = bi.filter((b: any) => b.surfacePackage != null).length;
  const nullSurface = bi.length - withSurface;
  console.log(`✓ allBusinessIntelligence() OK — ${bi.length} rows read (no throw)`);
  console.log(`  surface_package: ${withSurface} non-null · ${nullSurface} null (nulls accepted)`);

  // 2) Existing lead rows remain readable.
  const leads = await listLeads();
  console.log(`✓ listLeads() OK — ${leads.length} rows readable`);

  // 3) review_video_jobs (migration 0019) exists and is queryable.
  const jobs = await allReviewVideoJobs();
  console.log(`✓ review_video_jobs table OK — ${jobs.length} rows`);

  console.log("\nMIGRATION VERIFICATION: PASS");
}

main().then(() => process.exit(0)).catch((e) => { console.error("VERIFICATION FAILED:", e.message ?? e); process.exit(1); });

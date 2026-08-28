#!/usr/bin/env node
// Verifies Content Studio job durability/concurrency against a REAL Postgres (cs_jobs_test), using the
// prepared content_studio_jobs schema. Proves the invariants that a file store can't fully prove:
// DB-level dedup, atomic single-winner claim under a two-worker race, crash-lease recovery, and
// input-change staleness. Run: node scripts/verify-pg-jobs.mjs
import postgres from "postgres";
const sql = postgres(process.env.PG_TEST_URL || "postgres://jordanjackson@127.0.0.1:5432/cs_jobs_test", { max: 8, prepare: false });
let pass = 0, fail = 0;
const ok = (name, cond) => { (cond ? pass++ : fail++); console.log(`  ${cond ? "✓" : "✗"} ${name}`); };

async function reset() { await sql`TRUNCATE content_studio_jobs`; }
async function insertJob(id, piece, ver, status = "queued", lease = null) {
  await sql`INSERT INTO content_studio_jobs (id, piece_id, input_version, status, mode, lease_until)
    VALUES (${id}, ${piece}, ${ver}, ${status}, 'uploaded-vo', ${lease})`;
}
// Atomic claim: only succeeds if the row is still queued (the exact pattern a worker uses).
async function claim(id) {
  const rows = await sql`UPDATE content_studio_jobs SET status='rendering',
    lease_until = now() + interval '10 minutes', started_at = now()
    WHERE id=${id} AND status='queued' RETURNING id`;
  return rows.length === 1;
}

console.log("PG job durability (cs_jobs_test):");

// A) DB-level dedup — the partial unique index forbids two ACTIVE jobs for the same (piece, version).
await reset();
await insertJob("j1", "007", "vA");
let dupBlocked = false;
try { await insertJob("j2", "007", "vA"); } catch { dupBlocked = true; }
ok("duplicate active job (same piece+version) rejected by unique index", dupBlocked);
// but a DIFFERENT version is allowed
let diffOk = true;
try { await insertJob("j3", "007", "vB"); } catch { diffOk = false; }
ok("a different input version IS allowed (new render)", diffOk);

// B) Two-worker race for ONE job → exactly one winner.
await reset();
await insertJob("race1", "008", "vX");
const results = await Promise.all([claim("race1"), claim("race1"), claim("race1")]);
ok("two/three workers race one job → exactly ONE claims it", results.filter(Boolean).length === 1);

// C) Crash after claim → lease expires → recovery reclaims exactly once (no duplicate active).
await reset();
await insertJob("crash1", "009", "vY", "rendering", new Date(Date.now() - 60_000)); // leased in the past = crashed
const recovered = await sql`UPDATE content_studio_jobs SET status='queued', attempt = attempt + 1
  WHERE status='rendering' AND lease_until < now() RETURNING id`;
ok("crashed job (expired lease) is recovered to queued", recovered.length === 1 && recovered[0].id === "crash1");
const reclaimA = await claim("crash1");
const reclaimB = await claim("crash1");
ok("recovered job can be re-claimed by exactly one worker (no duplicate render)", reclaimA && !reclaimB);
const attempt = (await sql`SELECT attempt FROM content_studio_jobs WHERE id='crash1'`)[0].attempt;
ok("attempt counter incremented on recovery (retry, not silent loss)", Number(attempt) === 2);

// D) Restart persistence — rows survive a fresh connection (new pool = new process).
const sql2 = postgres(process.env.PG_TEST_URL || "postgres://jordanjackson@127.0.0.1:5432/cs_jobs_test", { max: 1, prepare: false });
const survive = await sql2`SELECT count(*)::int AS n FROM content_studio_jobs WHERE id='crash1'`;
ok("job persists across a new connection (app/worker restart)", survive[0].n === 1);
await sql2.end();

// E) Input change during render → prior output is stale (a newer version exists for the piece).
await reset();
await insertJob("old", "010", "v1", "ready");
await insertJob("new", "010", "v2", "rendering");
const newer = await sql`SELECT count(*)::int AS n FROM content_studio_jobs
  WHERE piece_id='010' AND input_version <> 'v1' AND status IN ('queued','rendering','ready')`;
ok("changed inputs make the prior ready output stale (newer version exists)", newer[0].n === 1);

await reset();
await sql.end();
console.log(`\nPG durability: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

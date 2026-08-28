#!/usr/bin/env node
// Verifies the REAL worker loop against a real Postgres (cs_jobs_test) with an INJECTED fake renderer
// (no Chrome needed) — proves the concurrency/lease/ownership/retry/exit invariants the design promises.
import postgres from "postgres";
import { drainQueue, claimOne, publishSuccess, recoverStale } from "./worker-loop.mjs";

const URL = process.env.PG_TEST_URL || "postgres://jordanjackson@127.0.0.1:5432/cs_jobs_test";
const sql = postgres(URL, { max: 8, prepare: false });
let pass = 0, fail = 0;
const ok = (n, c) => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}`); };
const reset = () => sql`TRUNCATE content_studio_jobs`;
// Distinct (piece,version) per job so the active-job unique index doesn't reject the seed.
const seed = (id, status = "queued") => sql`INSERT INTO content_studio_jobs (id,piece_id,input_version,status,mode) VALUES (${id},${"p-" + id},${"v-" + id},${status},'uploaded-vo')`;
const opts = { maxJobs: 25, timeoutMs: 5000, leaseMs: 30000, maxAttempts: 3, concurrency: 1 };
const okRender = async () => ({ outputKey: "/content/field-note-007/field-note-007-final.mp4", videoHash: "abc" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("PG worker loop (cs_jobs_test):");

// A) drain renders all queued jobs then EXITS (returns), no permanent loop.
await reset(); for (const id of ["a1", "a2", "a3"]) await seed(id);
let res = await drainQueue(sql, okRender, opts);
ok("drain renders all queued jobs and returns (exits)", res.rendered === 3);
ok("all jobs are 'ready' after drain", (await sql`SELECT count(*)::int n FROM content_studio_jobs WHERE status='ready'`)[0].n === 3);

// B) two workers drain concurrently → each job rendered exactly once (SKIP LOCKED, no double-claim).
await reset(); for (let i = 0; i < 6; i++) await seed("b" + i);
const [r1, r2] = await Promise.all([drainQueue(sql, okRender, opts), drainQueue(sql, okRender, opts)]);
ok("two concurrent workers render each job exactly once (6 total, no dup)", r1.rendered + r2.rendered === 6);
ok("no job left queued/rendering after concurrent drain", (await sql`SELECT count(*)::int n FROM content_studio_jobs WHERE status IN ('queued','rendering')`)[0].n === 0);

// C) STALE-WORKER REJECTION: an old owner cannot publish over a newer attempt.
await reset(); await seed("c1");
const claimed = await claimOne(sql, opts);                 // worker-1 owns attempt 1
// simulate crash + recovery: lease expires, another worker re-claims (attempt 2)
await sql`UPDATE content_studio_jobs SET lease_until = now() - interval '1 minute' WHERE id='c1'`;
await recoverStale(sql, opts);
const reclaimed = await claimOne(sql, opts);               // worker-2 owns attempt 2 (different worker_id in real run)
// worker-1 (stale) tries to publish its old attempt → must be REJECTED
const stalePublish = await publishSuccess(sql, { id: "c1", attempt: claimed.attempt }, await okRender());
ok("stale worker's publish is REJECTED (no overwrite of newer attempt)", stalePublish === false);
ok("job is still owned by the newer attempt", (await sql`SELECT attempt FROM content_studio_jobs WHERE id='c1'`)[0].attempt === reclaimed.attempt);

// D) crash recovery requeues (attempt < max) and fails after max attempts.
await reset(); await sql`INSERT INTO content_studio_jobs (id,piece_id,input_version,status,mode,attempt,lease_until) VALUES ('d1','007','v1','rendering','uploaded-vo',1, now() - interval '1 min')`;
let rec = await recoverStale(sql, opts);
ok("crashed job (attempt 1) recovered to queued", rec.includes("d1") && (await sql`SELECT status FROM content_studio_jobs WHERE id='d1'`)[0].status === "queued");
await sql`UPDATE content_studio_jobs SET status='rendering', attempt=3, lease_until=now() - interval '1 min' WHERE id='d1'`;
await recoverStale(sql, opts);
ok("crashed job at max attempts → failed (bounded retry, no infinite loop)", (await sql`SELECT status FROM content_studio_jobs WHERE id='d1'`)[0].status === "failed");

// E) a failing renderer retries up to the cap then fails.
await reset(); await seed("e1");
const boom = async () => { throw new Error("render blew up"); };
await drainQueue(sql, boom, { ...opts, maxJobs: 10 });   // one drain = one attempt (attempt→1, requeued)
await drainQueue(sql, boom, { ...opts, maxJobs: 10 });   // attempt→2, requeued
await drainQueue(sql, boom, { ...opts, maxJobs: 10 });   // attempt→3, failed
ok("failing job fails after max attempts (not forever)", (await sql`SELECT status FROM content_studio_jobs WHERE id='e1'`)[0].status === "failed");

await reset(); await sql.end();
console.log(`\nPG worker: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

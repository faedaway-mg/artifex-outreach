// Verifies the Postgres LIFECYCLE store (jobs/uploads/approvals/posted/shares) round-trips against a real
// database, and that a worker claim→publish updates the SAME job row the web enqueued. Run with
// CS_STORAGE_PROVIDER=postgres + CS_DATABASE_URL. Read-only-safe: uses a unique test piece and cleans up.
import * as L from "../src/lib/content-studio/cs-lifecycle-pg";
import type { RenderJob } from "../src/lib/content-studio/types";
import postgres from "postgres";

const piece = "zz-verify-" + Math.floor(performance.now());
const jobId = "csjob_verify_" + Math.floor(performance.now()).toString(36);
let pass = 0, fail = 0;
const ok = (n: boolean, m: string) => { n ? pass++ : fail++; console.log(`  ${n ? "✓" : "✗"} ${m}`); };
const now = new Date().toISOString();

const url = process.env.CS_DATABASE_URL || process.env.DATABASE_URL!;
const sql = postgres(url, { max: 2, prepare: false, ssl: /rlwy|railway/.test(url) ? { rejectUnauthorized: false } : undefined });

async function main() {
const job: RenderJob = {
  id: jobId, pieceId: piece, inputVersion: "v-verify", status: "queued", progress: 0, stage: "Queued",
  mode: "uploaded-vo", audioKind: "uploaded", audioFile: null, audioKey: "content-studio/staging/upload/op/u1.mp3",
  audioSha: "deadbeef", audioLabel: "vo.mp3", outputFile: null, outputRel: null, outputKey: null, posterKey: null,
  thumbRel: "/content/thumbnails/x.png", error: null, attempt: 0, pid: null,
  createdAt: now, updatedAt: now, startedAt: null, finishedAt: null,
};

try {
  // JOBS: web enqueue → read → list
  await L.writeJobPg(job);
  const read = await L.readJobPg(jobId);
  ok(!!read && read.status === "queued" && read.audioKey === job.audioKey, "job enqueued + read back (audioKey carried)");
  ok((await L.listJobsPg()).some((j) => j.id === jobId), "job appears in listJobsPg");

  // WORKER claims the SAME row (raw SQL mirrors worker-loop.claimOne), then publishes
  const claimed = await sql`UPDATE content_studio_jobs SET status='rendering', worker_id='w-verify',
      attempt=attempt+1, lease_until=now()+interval '2 min', started_at=now(), updated_at=now()
    WHERE id=${jobId} AND status='queued' RETURNING attempt`;
  ok(claimed.length === 1, "worker claimed the web-enqueued row (shared record)");
  const pub = await sql`UPDATE content_studio_jobs SET status='ready', progress=1, output_key='content-studio/staging/render-output/'||${jobId}||'/v.mp4',
      poster_key='content-studio/staging/poster/'||${jobId}||'/v.png', finished_at=now(), updated_at=now()
    WHERE id=${jobId} AND worker_id='w-verify' AND attempt=${claimed[0].attempt} AND status='rendering' RETURNING id`;
  ok(pub.length === 1, "worker published (ownership-fenced update)");
  const after = await L.readJobPg(jobId);
  ok(!!after && after.status === "ready" && !!after.outputKey && !!after.posterKey, "web reads ready job with output+poster keys (unified)");

  // UPLOADS
  await L.writeUploadPg({ pieceId: piece, file: "", objectKey: "content-studio/staging/upload/op/u1.mp3", sha256: "abc", name: "vo.mp3", bytes: 1234, durationSeconds: 30, uploadedAt: now, kind: "uploaded" });
  const ups = await L.listUploadsPg(piece);
  ok(ups.length === 1 && ups[0].objectKey === "content-studio/staging/upload/op/u1.mp3", "upload metadata round-trips");

  // APPROVALS
  await L.setApprovalPg({ pieceId: piece, jobId, inputVersion: "v-verify", outputRel: "", audioSig: "sig", approvedAt: now });
  ok((await L.readApprovalsPg())[piece]?.jobId === jobId, "approval set + read (version-bound)");
  await L.clearApprovalPg(piece);
  ok(!(await L.readApprovalsPg())[piece], "approval cleared");

  // POSTED
  await L.setPostedPg(piece, now);
  ok(!!(await L.readPostedPg())[piece], "posted marker round-trips");

  // SHARES
  const token = "verifytoken" + Math.floor(performance.now()).toString(36);
  await L.insertSharePg({ token, pieceId: piece, businessId: null, businessName: null, title: "t", intro: "i",
    videoHash: "h", inputVersion: "v-verify", videoKey: "content-studio/staging/render-output/" + jobId + "/v.mp4",
    posterKey: null, posterContentType: "image/jpeg", posterRel: "/x.png", emailThumbRel: null, createdAt: now, revokedAt: null });
  ok((await L.getSharePg(token))?.videoKey.includes(jobId), "share record persisted + read");
  ok(await L.revokeSharePg(token), "share revoked");
  ok((await L.getSharePg(token))?.revokedAt != null, "revocation durable");
} finally {
  // cleanup
  await sql`DELETE FROM content_studio_shares WHERE piece_id=${piece}`;
  await sql`DELETE FROM content_studio_posted WHERE piece_id=${piece}`;
  await sql`DELETE FROM content_studio_uploads WHERE piece_id=${piece}`;
  await sql`DELETE FROM content_studio_approvals WHERE piece_id=${piece}`;
  await sql`DELETE FROM content_studio_jobs WHERE piece_id=${piece}`;
  await sql.end();
  await L.__closeLifecyclePgForTests();
}
console.log(`\ncs-lifecycle: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

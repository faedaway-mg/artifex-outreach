import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { createRenderJob } from "@/lib/content-studio/runner";
import { readJob } from "@/lib/content-studio/store";
import { reconcileStale } from "@/lib/content-studio/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Internal render canary (section J). Exercises the REAL pipeline — enqueue → claim → render → publish —
// by re-rendering an approved-master Field Note through the normal createRenderJob path. It NEVER touches
// a prospect, never sends email, and never edits the database by hand; it only enqueues a render of a
// fixed internal piece and reports the job's honest status. Re-rendering an approved-master piece is
// deterministic (same script + approved audio + template version), so the piece's content is unchanged.
//
// Auth: an operator session, OR a shared-secret header for headless proving (x-cs-canary). The secret is
// only accepted when CS_CANARY_SECRET is configured — it can only ever trigger a render of the allowlist.
const CANARY_PIECES = new Set(["004", "005", "006"]);
const DEFAULT_CANARY_PIECE = "006"; // NOT #005 (the protected posted artifact)

function authorized(req: NextRequest): boolean {
  if (isAuthenticated()) return true;
  const secret = (process.env.CS_CANARY_SECRET ?? "").trim();
  return secret.length > 0 && req.headers.get("x-cs-canary") === secret;
}

function sanitize(job: any) {
  if (!job) return null;
  const j = reconcileStale(job);
  return {
    id: j.id, pieceId: j.pieceId, status: j.status, stage: j.stage, progress: j.progress,
    attempt: j.attempt, error: j.error,
    createdAt: j.createdAt, startedAt: j.startedAt, updatedAt: j.updatedAt, finishedAt: j.finishedAt,
  };
}

// POST → enqueue a canary render through the normal path. Returns the job id to poll.
// Defaults to the uploaded-VO path (useUpload:true) — the SAME path client videos render through,
// reusing the piece's existing uploaded voiceover so nothing new is written and no prospect is touched.
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let pieceId = DEFAULT_CANARY_PIECE;
  let useUpload = true;
  try {
    const b = await req.json();
    if (b?.pieceId && CANARY_PIECES.has(String(b.pieceId))) pieceId = String(b.pieceId);
    if (typeof b?.useUpload === "boolean") useUpload = b.useUpload;
  } catch { /* defaults */ }
  try {
    const { job, deduped } = await createRenderJob(pieceId, { useUpload });
    return NextResponse.json({ canary: true, pieceId, useUpload, deduped, job: sanitize(job) }, { status: deduped ? 200 : 202 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}

// GET ?job=<id> → the honest status of a canary job (same shape the UI poller reads).
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("job");
  if (!id) return NextResponse.json({ error: "job query param required" }, { status: 400 });
  const job = await readJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ job: sanitize(job) });
}

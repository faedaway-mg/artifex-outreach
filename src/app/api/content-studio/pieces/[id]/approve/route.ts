import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listJobs, setApproval, clearApproval, getPieces } from "@/lib/content-studio/store";
import { ensureCaption } from "@/lib/content-studio/caption-store";
import { latestReadyJob } from "@/lib/content-studio/job";
import { isProspectVideo } from "@/lib/content-studio/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → record an EXPLICIT approval of the piece's current ready render for posting. Refuses to approve
// a placeholder render. The approval is bound to the exact job + inputVersion, so any later input change
// (new audio/script) makes it stale automatically. DELETE → revoke.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jobs = await listJobs();
  const ready = latestReadyJob(jobs, params.id);
  // The durable output is the ArtifactStore key (outputKey); outputRel is a dev-only local URL (null in
  // staging/production). Accept either so an approval works against a cloud-published render.
  const outputRef = ready?.outputKey ?? ready?.outputRel ?? null;
  if (!ready || !outputRef) return NextResponse.json({ error: "No finished render to approve." }, { status: 409 });
  if (ready.audioKind === "placeholder") {
    return NextResponse.json({ error: "This render uses a placeholder voiceover — replace it with your real voiceover before approving." }, { status: 422 });
  }
  const approvedAt = new Date().toISOString();
  await setApproval({ pieceId: params.id, jobId: ready.id, inputVersion: ready.inputVersion, outputRel: outputRef, audioSig: ready.audioKind, approvedAt });
  // Posting-ready must ALWAYS have a caption: generate + save one from the approved script if absent
  // (idempotent — never overwrites an existing/owner-edited caption). The owner can edit/regenerate it.
  // Field Notes must always ship with a social caption; a Prospect Video package NEVER gets one (mandate I).
  const piece = (await getPieces()).find((p) => p.id === params.id);
  if (piece && !isProspectVideo(piece)) await ensureCaption({ id: piece.id, title: piece.title, concept: piece.concept, narration: piece.narration ?? [] });
  return NextResponse.json({ ok: true, approvedAt, outputRel: outputRef });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await clearApproval(params.id);
  return NextResponse.json({ ok: true });
}

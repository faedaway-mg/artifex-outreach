import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listJobs, setApproval, clearApproval } from "@/lib/content-studio/store";
import { latestReadyJob } from "@/lib/content-studio/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → record an EXPLICIT approval of the piece's current ready render for posting. Refuses to approve
// a placeholder render. The approval is bound to the exact job + inputVersion, so any later input change
// (new audio/script) makes it stale automatically. DELETE → revoke.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const jobs = await listJobs();
  const ready = latestReadyJob(jobs, params.id);
  if (!ready || !ready.outputRel) return NextResponse.json({ error: "No finished render to approve." }, { status: 409 });
  if (ready.audioKind === "placeholder") {
    return NextResponse.json({ error: "This render uses a placeholder voiceover — replace it with your real voiceover before approving." }, { status: 422 });
  }
  const approvedAt = new Date().toISOString();
  await setApproval({ pieceId: params.id, jobId: ready.id, inputVersion: ready.inputVersion, outputRel: ready.outputRel, audioSig: ready.audioKind, approvedAt });
  return NextResponse.json({ ok: true, approvedAt, outputRel: ready.outputRel });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await clearApproval(params.id);
  return NextResponse.json({ ok: true });
}

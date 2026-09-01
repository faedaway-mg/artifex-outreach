import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { setPosted, listJobs, readApprovals } from "@/lib/content-studio/store";
import { getCaption } from "@/lib/content-studio/caption-store";
import { latestReadyJob } from "@/lib/content-studio/job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPROVED_MASTER = ["001", "002", "003", "004", "005", "006"];

// POST → record that a piece was manually posted (a marker only — never auto-posts). GATED: you can
// only mark a piece posted once it has an APPROVED, non-placeholder output — so demo/placeholder records
// can't be fabricated into published history.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [jobs, approvals] = await Promise.all([listJobs(), readApprovals()]);
  const ready = latestReadyJob(jobs, params.id);
  const approval = approvals[params.id];
  const jobApproved = Boolean(ready && ready.audioKind !== "placeholder" && approval && approval.jobId === ready.id && approval.inputVersion === ready.inputVersion);
  const priorMaster = !ready && APPROVED_MASTER.includes(params.id); // #001–#006 approved finals
  if (!jobApproved && !priorMaster) {
    return NextResponse.json({ error: "Approve the render for posting first (placeholder/unapproved outputs can't be marked posted)." }, { status: 422 });
  }
  // Posting-ready REQUIRES a saved social caption — a posted video must always ship with its caption.
  const caption = await getCaption(params.id);
  if (!caption || !caption.text.trim()) {
    return NextResponse.json({ error: "Add and save a social caption before marking this posted (every posting-ready/posted video needs one)." }, { status: 422 });
  }
  const when = new Date().toISOString();
  await setPosted(params.id, when);
  return NextResponse.json({ ok: true, postedAt: when });
}

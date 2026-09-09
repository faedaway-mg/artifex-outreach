import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR-ONLY: persist a runbook checkbox (done/undone) so the technician workspace
// resumes exactly on reload. Freezes the playbook version on first write. Idempotent
// + audited in the store. Never accepts a secret.
export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { stepId?: string; done?: boolean; notes?: string; playbookId?: string };
  const stepId = String(body.stepId ?? "").trim();
  if (!stepId) return NextResponse.json({ ok: false, error: "stepId required" }, { status: 400 });
  const job = await store.getJob(params.offerId);
  if (!job) return NextResponse.json({ ok: false, error: "no paid job for this offer" }, { status: 404 });
  const updated = await store.setRunbookStep(params.offerId, stepId, {
    done: body.done === true,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : undefined,
    playbookId: body.playbookId,
  });
  return NextResponse.json({ ok: true, runbookState: updated?.runbookState ?? null });
}

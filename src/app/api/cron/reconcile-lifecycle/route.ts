import { NextRequest, NextResponse } from "next/server";
import { reconcileProspectLifecycle } from "@/lib/outreach/lifecycle-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// WHOLE-BOOK PROSPECT LIFECYCLE RECONCILER cron (mandate 12). Guarded by CRON_SECRET. Assembles verified
// renders into READY_TO_APPROVE, supersedes stale email bindings where a video package now exists, and
// enqueues renders for orphaned uploads. Idempotent. NEVER sends. ?dryRun=1 measures without mutating.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const apply = req.nextUrl.searchParams.get("dryRun") !== "1";
    const result = await reconcileProspectLifecycle({ apply });
    return NextResponse.json({ ok: true, sentEmails: 0, apply, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "reconcile failed" }, { status: 500 });
  }
}

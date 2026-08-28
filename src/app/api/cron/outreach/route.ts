import { NextRequest, NextResponse } from "next/server";
import { appendAudit } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled-outreach RUNNER — wired but DELIVERY-DISABLED by construction.
//
// This is the recurring entry point that would, once activated, dispatch approved + window-eligible
// Quick Reviews through the shared protections (window, shared 20/LA-day cap, suppression, pause,
// version-bound authorization). It cannot send today:
//   ENTRY boundary — requires QR_AUTOSEND_ENABLED=1 (off by default) → otherwise a pure no-op.
//   FINAL boundary — the transport handed to runScheduledOutreach is NON-DELIVERING and there is no
//                    scheduled batch wired, so even with the flag on there is NO path to a provider.
// Activating real delivery is a SEPARATE, explicit step (wire a delivering transport + a persisted
// scheduled batch). This route never invents a send path from missing configuration.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ENTRY gate: automated scheduled outreach is disabled unless explicitly enabled.
  if (process.env.QR_AUTOSEND_ENABLED !== "1") {
    return NextResponse.json({
      ok: true, dispatched: false, sent: 0,
      reason: "Scheduled outreach is DISABLED (QR_AUTOSEND_ENABLED != \"1\"). Operators prepare/approve; nothing dispatches automatically.",
    });
  }

  // Runtime pause (DB-backed + env) — honored even when the flag is on.
  const { outreachPausedNow } = await import("@/lib/outreach/outreach-pause");
  if (await outreachPausedNow()) {
    return NextResponse.json({ ok: true, dispatched: false, sent: 0, reason: "paused" });
  }

  // Run the REAL scheduler function so the wiring is exercised end-to-end, but with a NON-DELIVERING
  // transport and no scheduled batch — it authorizes/checks and dispatches to nothing. sent is always 0.
  const { runScheduledOutreach } = await import("@/lib/outreach/outreach-scheduler");
  const now = new Date();
  const summary = await runScheduledOutreach([], {
    now,
    campaignId: "scheduled-outreach",
    // FINAL boundary: refuse at the transport. No provider is wired here.
    send: async () => ({ ok: false, ambiguous: false, providerId: null }),
  });
  await appendAudit({
    action: "outreach.runner.ran-disabled", actor: "cron", targetType: "comms", targetId: null,
    meta: { laDay: summary.laDay, considered: summary.startedWith, sent: summary.sent, note: "delivery disabled — non-delivering transport, no scheduled batch" }, ip: null,
  });
  return NextResponse.json({
    ok: true, dispatched: false, sent: summary.sent,
    reason: "Scheduled-outreach runner executed with delivery DISABLED (non-delivering transport, no scheduled batch). Wiring a delivering transport is a separate, explicitly-authorized step.",
    summary,
  });
}

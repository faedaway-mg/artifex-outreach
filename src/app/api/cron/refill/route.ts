import { NextRequest, NextResponse } from "next/server";
import { runRefillCycle } from "@/lib/acquisition/refill-run";
import { advanceReadyInventory } from "@/lib/acquisition/pipeline-advance";
import { getSettings } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nationwide rolling-reserve REFILL (mandate §2/§7/§8). Guarded by CRON_SECRET. Measures the DELIVERY_READY
// reserve, sizes the shortfall to 60, plans tomorrow's ≤20 batch in recipient-local windows under the shared
// 20/day cap, and — with ?discover=1 and prospecting enabled — runs BOUNDED nationwide discovery beyond Los
// Angeles. It NEVER sends: actual sending only ever happens through the authorized scheduler.
//   ?discover=1        also run bounded discovery this tick (default: measure + plan only)
//   ?discoverCap=N     hard per-tick discovery ceiling (default 40)
//   ?maxLeads=N        cap leads resolved for the reserve measurement (default 2500)
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const wantDiscover = sp.get("discover") === "1";
    const settings = await getSettings();
    // Discovery only runs when it's explicitly asked for AND automation is enabled — otherwise this is a pure
    // read-only measurement + plan. Either way, zero emails are sent.
    const discover = wantDiscover && !!settings.prospecting?.enabled;
    // ?auto=1 → autonomous hysteresis: discovery no-ops when the ready reserve is at/above the refill
    // threshold (40). The scheduled cron uses this so it "does nothing when reserve is 40 or greater."
    const autoThreshold = sp.get("auto") === "1";
    const discoverCap = Math.max(1, Math.min(200, Number(sp.get("discoverCap") ?? 40)));
    const maxLeads = Math.max(1, Math.min(10000, Number(sp.get("maxLeads") ?? 2500)));

    const report = await runRefillCycle({ discover, autoThreshold, discoverCap, maxLeads });

    // ?advance=1 → run the DOWNSTREAM pipeline after discovery: bounded enrichment, deterministic
    // automatic approval (freeze SENDABLE fully-qualified leads → DELIVERY_READY), and persist real
    // scheduled bindings under the shared 20/day cap. This is what turns "discovered" into "scheduled
    // outreach". It still sends nothing (dispatch happens only on the authorized outreach runner).
    // ?advanceDry=1 measures the downstream funnel without approving or scheduling anything.
    const wantAdvance = sp.get("advance") === "1" || sp.get("advanceDry") === "1";
    const advance = wantAdvance
      ? await advanceReadyInventory({
          maxLeads,
          dryRun: sp.get("advanceDry") === "1",
          enrichCap: Math.max(0, Math.min(200, Number(sp.get("enrichCap") ?? 24))),
          approveCap: Math.max(0, Math.min(200, Number(sp.get("approveCap") ?? 40))),
          scheduleCap: Math.max(0, Math.min(20, Number(sp.get("scheduleCap") ?? 20))),
        })
      : null;

    return NextResponse.json({
      ok: true,
      sentEmails: (report.emailsSentDuringRefill as number) + (advance?.emailsSent ?? 0), // always 0 — never sends
      discoverRequested: wantDiscover,
      discoverRan: !!report.discovery?.ran,
      advance, // downstream pipeline result (enrich → automatic approval → schedule); null unless ?advance=1
      reserve: report.visibility.readyReserve,
      refillStatus: report.visibility.refillStatus,
      reserveBefore: report.reserveBefore,
      shortfallToTarget: report.reserve.shortfallToTarget,
      forwardCoverageDays: report.reserve.forwardDays,
      tomorrowScheduled: report.visibility.tomorrowScheduled,
      batchShortfall: report.batch.shortfall,
      funnel: report.funnel,
      plan: report.plan,
      discovery: report.discovery,
      cap: report.cap,
      geographicDistribution: report.geographicDistribution,
      batchByState: report.batch.byState,
      picks: report.batch.picks,
      visibility: report.visibility,
      checkpoint: report.checkpoint,
      stop: report.stop,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "refill cycle failed" }, { status: 500 });
  }
}

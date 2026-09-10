import { NextRequest, NextResponse } from "next/server";
import { computeLeadSprintSnapshot } from "@/lib/lead-sprint/snapshot";
import { rampView } from "@/lib/comms/ramp-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NATIONAL LEAD SPRINT — FREE pipeline cron (#183). Runs continuously (scheduled by Railway) to refresh
// the ranked qualified pool over the live lead inventory. READ-ONLY: it discovers/dedupes/suppression-
// checks/qualifies/scores/ranks — NO paid compute, NO prospect contact, NO writes to lead state. Guarded
// by CRON_SECRET. Delivery + autosend remain OFF regardless of what this produces.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date().toISOString();
    // Near-term capacity comes from the PERSISTED ramp: SUM of each lane's own effective cap (no quota
    // transfer). Reflects real warm-up state + seed placement (Outlook Junk keeps promotion blocked).
    const ramp = await rampView(now);
    const nearTermCapacity = ramp.combinedDailyCapacity;

    const podsOnly = req.nextUrl.searchParams.get("national") !== "1";
    const snapshot = await computeLeadSprintSnapshot({ now, nearTermCapacity, podsOnly });

    // Return counts only — no prospect PII, no secrets. (The dashboard renders the same compute directly.)
    return NextResponse.json({
      ok: true,
      generatedAt: snapshot.generatedAt,
      scope: snapshot.scope,
      nearTermCapacity,
      counts: {
        discovered: snapshot.discovered,
        deduped: snapshot.deduped,
        suppressed: snapshot.suppressed,
        cheaplyQualified: snapshot.cheaplyQualified,
        rankedPool: snapshot.rankedPool,
        rejectedBeforePaid: snapshot.rejectedBeforePaid,
        finalists: snapshot.finalists.length,
        avgSendValue: snapshot.avgSendValue,
      },
      readyToSendTarget: snapshot.readyToSendTarget,
      marketDistribution: snapshot.marketDistribution,
      ramp: {
        lanes: ramp.lanes.map((l) => ({ laneId: l.laneId, state: l.state, level: l.level, effectiveDailyCap: l.effectiveDailyCap })),
        seed: ramp.seed,
        outlookBlocksPromotion: ramp.outlookBlocksPromotion,
      },
      note: "read-only free pipeline — no paid compute, no prospect contact, delivery OFF",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

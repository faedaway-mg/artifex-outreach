import { NextRequest, NextResponse } from "next/server";
import { dailyReview } from "@/lib/launch/review";
import { appendAudit } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 6 — Daily Learning Review. Triggered by the Railway cron once at end of day
// (guarded by CRON_SECRET). Returns the operational debrief as JSON and records that
// the review ran; the operator reads it from the Launch dashboard or logs.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const review = await dailyReview();
    await appendAudit({
      action: "launch.daily_review",
      actor: "cron",
      targetType: "launch",
      targetId: review.date,
      meta: { activity: review.activity, suggestions: review.suggestions.length },
      ip: null,
    });

    return NextResponse.json({ ok: true, review });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "daily-review failed" }, { status: 500 });
  }
}

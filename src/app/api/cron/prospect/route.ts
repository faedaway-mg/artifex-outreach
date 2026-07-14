import { NextRequest, NextResponse } from "next/server";
import { getSettings } from "@/lib/repo";
import { runProspecting } from "@/lib/prospecting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Triggered by the scheduled cron (Railway) once per day. Guarded by CRON_SECRET.
// Runs only when automation is enabled and today is a configured weekday
// (America/Los_Angeles). Never contacts anyone; only discovers + qualifies.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const settings = await getSettings();
  const p = settings.prospecting;
  if (!p.enabled) {
    return NextResponse.json({ ok: true, skipped: "automation paused" });
  }

  // Weekday check in America/Los_Angeles
  const laDay = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short" });
  const dayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(laDay.slice(0, 3));
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !p.weekdays.includes(dayIndex)) {
    return NextResponse.json({ ok: true, skipped: `not a configured weekday (${laDay})` });
  }

  const run = await runProspecting({ trigger: "scheduled" });
  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      providerMode: run.providerMode,
      searchesPerformed: run.searchesPerformed,
      placesRequests: run.placesRequests,
      examined: run.examined,
      duplicatesRemoved: run.duplicatesRemoved,
      excluded: run.excluded,
      addedToToday: run.addedToToday,
      estimatedCostUsd: run.estimatedCostUsd,
      errors: run.errors,
    },
  });
}

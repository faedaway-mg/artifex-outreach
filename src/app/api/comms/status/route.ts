import { NextRequest, NextResponse } from "next/server";
import { commsMetrics } from "@/lib/comms/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operational metrics for the communication layer. Guarded by CRON_SECRET so an
// external monitor can poll it. Pass ?health=1 to include a live provider ping.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const includeProviderHealth = req.nextUrl.searchParams.get("health") === "1";
  const metrics = await commsMetrics({ includeProviderHealth });
  return NextResponse.json({ ok: true, metrics });
}

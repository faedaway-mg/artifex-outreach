import { NextRequest, NextResponse } from "next/server";
import { runDeepRecapture } from "@/lib/content-studio/deep-recapture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// AUTOMATIC DEEP-RECAPTURE cron (mandate parts 3/5/6). Guarded by CRON_SECRET. For every company that is
// ELIGIBLE per the one canonical selector but stuck short of voiceover-ready, it re-crawls the site,
// refreshes evidence + screenshot, recomposes + gates the narration, and rebuilds the full chain to a
// bounded terminal outcome (VOICEOVER_READY / AUTOMATICALLY_EXCLUDED / RETRY_SCHEDULED / NEEDS_ATTENTION).
// It NEVER sends or contacts a prospect. Bounded per tick by ?max (default 10).
//   ?max=N     hard ceiling on live crawls this tick (default 10, cap 25)
//   ?leadIds=a,b,c  restrict to a specific set (targeted operator/acceptance run)
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // Recapture is on by default; DEEP_RECAPTURE_ENABLED=0 disables without a redeploy.
  if (process.env.DEEP_RECAPTURE_ENABLED === "0") {
    return NextResponse.json({ ok: true, disabled: true });
  }
  try {
    const sp = req.nextUrl.searchParams;
    const max = Math.max(1, Math.min(25, Number(sp.get("max") ?? 10)));
    const leadIds = sp.get("leadIds")?.split(",").map((s) => s.trim()).filter(Boolean);
    const result = await runDeepRecapture({ max, leadIds: leadIds?.length ? leadIds : undefined });
    return NextResponse.json({ ok: true, sentEmails: 0, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "recapture failed" }, { status: 500 });
  }
}

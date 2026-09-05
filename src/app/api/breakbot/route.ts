import { NextRequest, NextResponse } from "next/server";
import { isolatedStoreOk } from "@/lib/breakbot/isolation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TEST-ONLY Breakbot harness endpoint (mandate 19). FAIL-CLOSED: it responds ONLY inside a genuinely
// isolated Breakbot tenant (no DATABASE_URL, no RESEND_API_KEY, BREAKBOT_TEST_TENANT=1). On any production
// deployment isolatedStoreOk() is false → this route is inert (403), so it can never seed/reset real data.
// Seeds/resets the in-memory namespace and reports its state for the synthetic-user journeys.
async function guardOr403(): Promise<NextResponse | null> {
  if (!isolatedStoreOk()) return NextResponse.json({ ok: false, error: "breakbot endpoint is inert outside an isolated test tenant" }, { status: 403 });
  return null;
}

export async function GET() {
  const blocked = await guardOr403(); if (blocked) return blocked;
  const { breakbotStateSummary } = await import("@/lib/breakbot/namespace");
  return NextResponse.json({ ok: true, state: await breakbotStateSummary() });
}

export async function POST(req: NextRequest) {
  const blocked = await guardOr403(); if (blocked) return blocked;
  const action = req.nextUrl.searchParams.get("action");
  const ns = await import("@/lib/breakbot/namespace");
  if (action === "reset") { ns.resetBreakbotNamespace(); return NextResponse.json({ ok: true, reset: true, state: await ns.breakbotStateSummary() }); }
  if (action === "seed") {
    const ids = req.nextUrl.searchParams.get("ids")?.split(",").filter(Boolean);
    const r = await ns.seedBreakbotFixtures(ids);
    return NextResponse.json({ ok: true, ...r, state: await ns.breakbotStateSummary() });
  }
  return NextResponse.json({ ok: false, error: "unknown action (seed|reset)" }, { status: 400 });
}

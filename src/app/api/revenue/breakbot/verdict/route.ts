import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { breakbotVerdictView } from "@/lib/quick-fix/operator-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR ONLY (authenticated), READ-ONLY. Runs the Breakbot adversarial pre-flight
// over ONE real stored offer and returns its verdict. This is a QA GATE — it never
// approves, sends, charges, schedules, or mutates any state (Part Y, fail-closed).
export async function GET(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const offerId = req.nextUrl.searchParams.get("offerId");
  if (!offerId) return NextResponse.json({ ok: false, error: "offerId required" }, { status: 400 });
  const verdict = await breakbotVerdictView(offerId);
  if (!verdict) return NextResponse.json({ ok: false, error: "no stored offer for that id" }, { status: 404 });
  return NextResponse.json({ ok: true, verdict });
}

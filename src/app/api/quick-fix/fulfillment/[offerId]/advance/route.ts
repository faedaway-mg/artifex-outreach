import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import type { JobState } from "@/lib/quick-fix/types";
import { advanceJobState } from "@/lib/quick-fix/fulfillment-advance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR-ONLY fulfillment state advance. Delegates to the SINGLE canonical transition primitive
// (advanceJobState) so the HTTP path and internal fixtures share one source of transition truth — the
// customer portal (a pure projection of the job) updates automatically after every transition. This
// NEVER creates a job and NEVER touches payment; requires an operator session.
const ALLOWED: JobState[] = ["READY_FOR_FULFILLMENT", "IN_PROGRESS", "QA", "DELIVERED", "COMPLETE", "REFUNDED", "CANCELED"];

export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { to?: string; note?: string };
  const to = body.to as JobState | undefined;
  if (!to || !ALLOWED.includes(to)) return NextResponse.json({ ok: false, error: "invalid target state" }, { status: 400 });

  const res = await advanceJobState(params.offerId, to, { actor: "operator", note: body.note });
  if (res.ok) return NextResponse.json({ ok: true, state: res.state, ...(res.unchanged ? { unchanged: true } : {}) });
  const status = res.code === "no-job" || res.code === "offer-missing" ? 404 : res.code === "illegal-transition" || res.code === "gate-unmet" ? 409 : 400;
  return NextResponse.json({ ok: false, error: res.error, ...(res.blockers ? { blockers: res.blockers } : {}) }, { status });
}

// Best-effort platform detection from a lead's business intelligence (CMS signature).
function extractPlatform(bi: any): string | null {
  const p = bi?.profile?.businessProfile ?? bi?.businessProfile ?? null;
  const blob = JSON.stringify(p ?? "").toLowerCase();
  for (const k of ["wordpress", "shopify", "squarespace", "webflow", "wix", "godaddy"]) if (blob.includes(k)) return k;
  return null;
}

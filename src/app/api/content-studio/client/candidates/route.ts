import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listReviewVideoCandidates } from "@/lib/review-video/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → eligible prospect/client businesses for a review video (reuses the REAL review-video readiness
// gate + candidate ranking). Businesses live in Postgres; an empty list here means the local/mock store
// has no businesses with stored evidence (the gate is unchanged, there's just nothing to rank).
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const candidates = await listReviewVideoCandidates();
    return NextResponse.json({
      candidates: candidates.map((c) => ({ leadId: c.leadId, businessName: c.businessName, readiness: c.readiness.readiness, eligible: c.readiness.eligible, overridable: c.readiness.overridable, blockers: c.readiness.blockers, hasJob: c.hasJob })),
    });
  } catch (e: any) {
    return NextResponse.json({ candidates: [], note: "No business store available: " + String(e?.message ?? e) });
  }
}

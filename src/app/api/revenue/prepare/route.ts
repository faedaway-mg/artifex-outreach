import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listLeads, getBusinessIntelligence } from "@/lib/repo";
import { buildOfferForLead } from "@/lib/quick-fix/adapter";
import * as store from "@/lib/quick-fix/store";
import { offerSharePath } from "@/lib/quick-fix/page-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR ONLY (authenticated). Rebuilds the evidence-backed offer for a lead,
// persists it, and — as the operator's explicit sign-off — approves it, returning
// the customer share link. Nothing is sent; automation stays ASSISTED.
export async function POST(req: NextRequest) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { leadId?: string; approve?: boolean };
  if (!body.leadId) return NextResponse.json({ ok: false, error: "leadId required" }, { status: 400 });

  const leads = await listLeads();
  const lead = leads.find((l) => l.id === body.leadId);
  if (!lead) return NextResponse.json({ ok: false, error: "lead not found" }, { status: 404 });

  const bi = await getBusinessIntelligence(lead.id).catch(() => null);
  const profile = (bi?.profile as any)?.businessProfile ?? null;
  const opps = Array.isArray(profile?.opportunities) ? profile.opportunities : [];
  const offer = buildOfferForLead({ leadId: lead.id, companyName: (lead as any).businessName ?? lead.id, opportunities: opps, website: (lead as any).website, generatedAt: new Date().toISOString() });

  if (!offer.quickFixEligible) return NextResponse.json({ ok: false, error: `not quick-fix eligible: ${offer.notEligibleReason ?? "no concrete fixable defect"}` }, { status: 422 });

  const now = new Date().toISOString();
  const stored = await store.upsertOffer(offer, { recipientEmail: (lead as any).email ?? null, now });
  // Approval defaults on (operator-initiated action); pass approve:false to persist as draft.
  if (body.approve !== false) await store.setApproval(stored.offerId, "approved", "operator", now);

  const path = offerSharePath(stored);
  return NextResponse.json({ ok: true, offerId: stored.offerId, shareToken: stored.shareToken, url: path });
}

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import * as store from "@/lib/quick-fix/store";
import { canTransitionJob } from "@/lib/quick-fix/fulfillment";
import type { JobState, QuickFixOffer } from "@/lib/quick-fix/types";
import { appendAudit, getBusinessIntelligence } from "@/lib/repo";
import { deliveryGate, transitionRequiresGate } from "@/lib/quick-fix/fulfillment-gates";
import { normalizePlatform } from "@/lib/quick-fix/fulfillment-center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// OPERATOR-ONLY fulfillment state advance. Moves a paid job through the canonical
// state machine (READY_FOR_FULFILLMENT → IN_PROGRESS → QA → DELIVERED → COMPLETE, or
// REFUNDED/CANCELED for a scope exception). Every transition is validated by
// canTransitionJob() (illegal jumps are rejected) and audited. This NEVER creates a
// job (only the verified webhook does) and NEVER touches payment. Not reachable by a
// customer — requires an operator session.
const ALLOWED: JobState[] = ["READY_FOR_FULFILLMENT", "IN_PROGRESS", "QA", "DELIVERED", "COMPLETE", "REFUNDED", "CANCELED"];

export async function POST(req: NextRequest, { params }: { params: { offerId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { to?: string; note?: string };
  const to = body.to as JobState | undefined;
  if (!to || !ALLOWED.includes(to)) return NextResponse.json({ ok: false, error: "invalid target state" }, { status: 400 });

  const job = await store.getJob(params.offerId);
  if (!job) return NextResponse.json({ ok: false, error: "no paid job for this offer" }, { status: 404 });
  if (job.state === to) return NextResponse.json({ ok: true, state: job.state, unchanged: true });
  if (!canTransitionJob(job.state, to)) {
    return NextResponse.json({ ok: false, error: `illegal transition ${job.state} → ${to}` }, { status: 409 });
  }

  // SERVER-SIDE GATE (authoritative): a job cannot reach DELIVERED/COMPLETE without the
  // required QA + production retest + before/after evidence PERSISTED on the job. Read
  // from persisted sub-state only — never trust a client flag.
  if (transitionRequiresGate(to)) {
    const offer = await store.getOffer(params.offerId);
    if (!offer) return NextResponse.json({ ok: false, error: "offer not found" }, { status: 404 });
    const bi = await getBusinessIntelligence(offer.leadId).catch(() => null);
    const platform = normalizePlatform(extractPlatform(bi));
    const gate = deliveryGate(offer as unknown as QuickFixOffer, job, platform);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: "delivery gate not satisfied", blockers: gate.blockers }, { status: 409 });
    }
  }

  const now = new Date().toISOString();
  const updated = { ...job, state: to, updatedAt: now };
  await store.upsertJob(updated);
  await appendAudit({ action: "quickfix.fulfillment_advanced", actor: "operator", targetType: "quickfix_offer", targetId: params.offerId, meta: { from: job.state, to, note: (body.note ?? "").slice(0, 300) }, ip: null });
  return NextResponse.json({ ok: true, state: updated.state });
}

// Best-effort platform detection from a lead's business intelligence (CMS signature).
function extractPlatform(bi: any): string | null {
  const p = bi?.profile?.businessProfile ?? bi?.businessProfile ?? null;
  const blob = JSON.stringify(p ?? "").toLowerCase();
  for (const k of ["wordpress", "shopify", "squarespace", "webflow", "wix", "godaddy"]) if (blob.includes(k)) return k;
  return null;
}

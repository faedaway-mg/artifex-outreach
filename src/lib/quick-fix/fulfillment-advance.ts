// ─────────────────────────────────────────────────────────────────────────────
// FULFILLMENT ADVANCE + PURCHASE→PROJECT (Customer Portal mandate CP7 · §12) — the ONE canonical seam for
// moving a job through the state machine and for creating the fulfillment project on purchase. The
// operator advance route delegates here so there is a SINGLE source of transition truth (no drift), and
// the portal — a pure projection of the job — updates automatically after every transition.
//
// No duplicate state: the job is authoritative; this module only mutates the job (via the store) and
// audits. It never sends, never charges, never touches payment truth.
// ─────────────────────────────────────────────────────────────────────────────
import * as store from "./store";
import type { JobRecord } from "./store";
import type { JobState, QuickFixOffer } from "./types";
import { canTransitionJob, initialJobStateAfterPayment } from "./fulfillment";
import { deliveryGate, transitionRequiresGate } from "./fulfillment-gates";
import { normalizePlatform } from "./fulfillment-center";
import { getBusinessIntelligence, appendAudit } from "../repo";

export type AdvanceResult =
  | { ok: true; state: JobState; unchanged?: boolean }
  | { ok: false; code: "no-job" | "illegal-transition" | "gate-unmet" | "offer-missing"; error: string; blockers?: string[] };

// Best-effort CMS detection from a lead's business intelligence (mirrors the offer/advance routes).
function extractPlatform(bi: unknown): string | null {
  const p = (bi as any)?.profile?.businessProfile ?? (bi as any)?.businessProfile ?? null;
  const blob = JSON.stringify(p ?? "").toLowerCase();
  for (const k of ["wordpress", "shopify", "squarespace", "webflow", "wix", "godaddy"]) if (blob.includes(k)) return k;
  return null;
}

/**
 * Advance a job to `to`, enforcing the canonical transition rules AND the server-side delivery gate
 * (DELIVERED/COMPLETE require persisted QA + production retest + before/after evidence). Idempotent: a
 * no-op when already in `to`. Audited. This is the single primitive the HTTP route and the fixtures share.
 */
export async function advanceJobState(
  offerId: string,
  to: JobState,
  opts: { now?: string; actor?: string; note?: string } = {},
): Promise<AdvanceResult> {
  const now = opts.now ?? new Date().toISOString();
  const job = await store.getJob(offerId);
  if (!job) return { ok: false, code: "no-job", error: "no paid job for this offer" };
  if (job.state === to) return { ok: true, state: job.state, unchanged: true };
  if (!canTransitionJob(job.state, to)) return { ok: false, code: "illegal-transition", error: `illegal transition ${job.state} → ${to}` };

  if (transitionRequiresGate(to)) {
    const offer = await store.getOffer(offerId);
    if (!offer) return { ok: false, code: "offer-missing", error: "offer not found" };
    const bi = await getBusinessIntelligence(offer.leadId).catch(() => null);
    const platform = normalizePlatform(extractPlatform(bi));
    const gate = deliveryGate(offer as unknown as QuickFixOffer, job, platform);
    if (!gate.ok) return { ok: false, code: "gate-unmet", error: "delivery gate not satisfied", blockers: gate.blockers };
  }

  const updated: JobRecord = { ...job, state: to, updatedAt: now };
  await store.upsertJob(updated);
  await appendAudit({ action: "quickfix.fulfillment_advanced", actor: opts.actor ?? "operator", targetType: "quickfix_offer", targetId: offerId, meta: { from: job.state, to, note: (opts.note ?? "").slice(0, 300) }, ip: null });
  return { ok: true, state: to };
}

/**
 * Idempotent purchase→project creation (§CP7). Given a paid offer, ensure a fulfillment job exists with
 * the correct initial state (WAITING_FOR_CUSTOMER_INPUT when intake is needed, else READY_FOR_FULFILLMENT),
 * the purchase timestamp, and the frozen scope (the offer itself IS the frozen scope — nothing is copied).
 * Retrying NEVER creates a duplicate job/token: the offerId keys the job and the portal token is the
 * offer's own share token. Returns the (existing or created) job. Never charges; payment truth stays with
 * the checkout/webhook — this only materializes the fulfillment projection.
 */
export async function ensureFulfillmentProject(
  offer: { offerId: string; leadId: string },
  opts: { needsIntake: boolean; now?: string; actor?: string; isDemo?: boolean },
): Promise<{ job: JobRecord; created: boolean }> {
  const now = opts.now ?? new Date().toISOString();
  const existing = await store.getJob(offer.offerId);
  if (existing) return { job: existing, created: false }; // idempotent — no duplicate customer/order/project/token

  const state = initialJobStateAfterPayment(opts.needsIntake);
  const job: JobRecord = {
    offerId: offer.offerId,
    leadId: offer.leadId,
    state,
    purchasedAt: now,
    requirementsReceivedAt: null,
    fulfillmentClockStartedAt: opts.needsIntake ? null : now,
    targetDeliveryAt: null,
    subscriptionId: null,
    updatedAt: now,
    ...(opts.isDemo ? { isDemo: true } : {}),
  };
  await store.upsertJob(job);
  await appendAudit({ action: "quickfix.job_created", actor: opts.actor ?? "system", targetType: "quickfix_offer", targetId: offer.offerId, meta: { state, isDemo: !!opts.isDemo }, ip: null });
  return { job, created: true };
}

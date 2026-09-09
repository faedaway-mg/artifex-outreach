// ─────────────────────────────────────────────────────────────────────────────
// PAGE SERVICE — assembles the customer-facing view models from stored state.
// Used by the public /offer routes AND the operator "preview as customer" surface,
// so both render from exactly one source. Reads only; never charges, never sends.
// Only customer-safe fields cross this boundary (no internal economics/scoring).
// ─────────────────────────────────────────────────────────────────────────────
import * as store from "./store";
import type { StoredOffer } from "./store";
import { buildOfferPageModel, type OfferPageModel } from "./offer-page";
import { selectActiveEvergreen } from "./evergreen-asset";
import { termsAcceptanceMatchesOffer } from "./terms";
import { buildRequirements, type RequirementsChecklist } from "./requirements";
import { ARTIFEX_IDENTITY } from "../identity";
import { quickFixStripeConfigured } from "./stripe-mode";

export function stripeConfigured(): boolean {
  // Mode-aware: reflects whether the ACTIVE Quick-Fix mode (test/live) has its key.
  return quickFixStripeConfigured();
}

/** The public link path for an offer (share token — unguessable, revocable). */
export function offerSharePath(offer: StoredOffer): string {
  return `/offer/${offer.shareToken}`;
}

export interface PublicOfferView {
  offer: StoredOffer;
  model: OfferPageModel;
  approved: boolean;
  superseded: boolean;
  termsAccepted: boolean;
}

/** Resolve + assemble the customer offer page for a share token OR raw offerId. */
export async function buildPublicOfferView(seg: string, opts?: { preview?: boolean }): Promise<PublicOfferView | null> {
  const offer = await store.resolveOffer(seg);
  if (!offer) return null;
  const evergreen = selectActiveEvergreen(await store.getEvergreen());
  const acc = await store.getTermsAcceptance(offer.offerId);
  const termsAccepted = termsAcceptanceMatchesOffer(acc, offer);
  const approved = offer.approvalStatus === "approved";
  const superseded = offer.state === "SUPERSEDED";
  const model = buildOfferPageModel({
    offer,
    evergreen,
    approved,
    // In preview we still show the buy CTA disabled with an honest reason.
    stripeConfigured: stripeConfigured(),
    termsAccepted,
    superseded,
    bookingUrl: ARTIFEX_IDENTITY.bookingUrl,
  });
  return { offer, model, approved, superseded, termsAccepted };
}

// ── Payment status (success page reads CONFIRMED state — never decides itself) ──
export type PaymentStatus =
  | "PAYMENT_CONFIRMING"
  | "PAID"
  | "INTAKE_REQUIRED"
  | "READY_FOR_FULFILLMENT"
  | "PAYMENT_NOT_CONFIRMED";

export interface PaymentStatusView {
  offerId: string;
  status: PaymentStatus;
  jobState: string | null;
  targetDeliveryAt: string | null;
  /** Where the customer should go next (intake if required). */
  nextPath: string | null;
}

export async function paymentStatusView(seg: string): Promise<PaymentStatusView | null> {
  const offer = await store.resolveOffer(seg);
  const offerId = offer?.offerId ?? seg;
  const job = await store.getJob(offerId);
  if (job) {
    let status: PaymentStatus;
    if (job.state === "WAITING_FOR_CUSTOMER_INPUT") status = "INTAKE_REQUIRED";
    else if (job.state === "PAID") status = "PAID";
    else status = "READY_FOR_FULFILLMENT"; // READY/IN_PROGRESS/QA/DELIVERED/COMPLETE
    return {
      offerId,
      status,
      jobState: job.state,
      targetDeliveryAt: job.targetDeliveryAt,
      nextPath: status === "INTAKE_REQUIRED" ? `/offer/${offer?.shareToken ?? offerId}/intake` : null,
    };
  }
  // No job yet — was a checkout ever created? If so, the webhook may still be in flight.
  const commerce = await store.commerceStore.listForOffer(offerId);
  const status: PaymentStatus = commerce.length ? "PAYMENT_CONFIRMING" : "PAYMENT_NOT_CONFIRMED";
  return { offerId, status, jobState: null, targetDeliveryAt: null, nextPath: null };
}

// ── Intake view ────────────────────────────────────────────────────────────────
export interface IntakeView {
  offer: StoredOffer;
  requirements: RequirementsChecklist;
  jobState: string | null;
  requirementsReceivedAt: string | null;
  targetDeliveryAt: string | null;
  /** True once the delivery clock has started (blocking requirements satisfied). */
  clockStarted: boolean;
  paid: boolean;
}

export async function buildIntakeView(seg: string): Promise<IntakeView | null> {
  const offer = await store.resolveOffer(seg);
  if (!offer) return null;
  const job = await store.getJob(offer.offerId);
  return {
    offer,
    requirements: buildRequirements(offer),
    jobState: job?.state ?? null,
    requirementsReceivedAt: job?.requirementsReceivedAt ?? null,
    targetDeliveryAt: job?.targetDeliveryAt ?? null,
    clockStarted: !!job?.fulfillmentClockStartedAt,
    paid: !!job,
  };
}

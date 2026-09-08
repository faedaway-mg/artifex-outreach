// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE SAFETY — the single gate EVERY purchase path must pass before a live
// checkout can be created. If any check fails, no checkout is created.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer, OfferState } from "./types";
import { capabilityByKey, isSellable } from "./capabilities";
import { TIER_BY_BAND } from "./pricing";
import { buildStripeDescription } from "./stripe-copy";

export interface PurchaseSafetyInput {
  offer: QuickFixOffer;
  /** Approved by an operator (unless AUTO_ELIGIBLE class cleared automation). */
  approved: boolean;
  /** Stripe is configured in this environment. */
  stripeConfigured: boolean;
  /** A newer offerVersion exists for this lead (this one is superseded). */
  superseded: boolean;
  /** The lead is on terminal rejection / suppression (never sell). */
  leadBlocked: boolean;
}

export interface PurchaseSafetyResult {
  ok: boolean;
  reasons: string[];
}

/** All purchase paths call this. Fail-closed. */
export function validateOfferForPurchase(input: PurchaseSafetyInput): PurchaseSafetyResult {
  const { offer } = input;
  const reasons: string[] = [];

  if (!offer.quickFixEligible) reasons.push("offer is not quick-fix eligible");
  if (input.leadBlocked) reasons.push("lead is rejected/suppressed");
  if (input.superseded || offer.state === "SUPERSEDED") reasons.push("a newer offer version supersedes this one");
  if (!input.approved) reasons.push("offer is not approved");

  // Evidence + economics gates (re-checked here — defense in depth).
  if (offer.confidence <= 0) reasons.push("no evidence backing");
  if (!offer.economics.clearsMarginGate) reasons.push("fails economics guardrail");

  // Capability validity — every bundled capability must still be sellable.
  if (offer.capabilityKeys.length === 0) reasons.push("no capability bound");
  for (const k of offer.capabilityKeys) {
    const cap = capabilityByKey(k);
    if (!cap) reasons.push(`capability ${k} not found`);
    else if (!isSellable(cap)) reasons.push(`capability ${k} is not sellable (${cap.state})`);
  }

  // Price validity — must equal the canonical tier price (LLM can't move it).
  const tier = TIER_BY_BAND.get(offer.band);
  if (!tier) reasons.push(`unknown pricing band ${offer.band}`);
  else if (offer.priceCents !== tier.priceCents) reasons.push(`price ${offer.priceCents} != canonical tier price ${tier.priceCents}`);

  // Scope completeness.
  if (!offer.scope.offerName) reasons.push("missing offer name");
  if (!offer.scope.includedItems.length) reasons.push("missing included scope");
  if (!offer.scope.deliveryWindow) reasons.push("missing delivery window");
  if (!offer.scope.customerInputsRequired.length) reasons.push("missing required customer inputs");
  if (!offer.scope.revisionPolicy) reasons.push("missing revision policy");

  // Customer-facing text must be safe (no fabrication / no internal leak).
  if (!buildStripeDescription(offer).safe) reasons.push("customer-facing description failed the fabrication/leak guard");

  // Stripe must be usable to create a real checkout.
  if (!input.stripeConfigured) reasons.push("Stripe is not configured in this environment");

  return { ok: reasons.length === 0, reasons };
}

/** States from which a checkout may legitimately be (re)started. */
export const CHECKOUTABLE_STATES: OfferState[] = ["APPROVED", "SENT", "VIEWED", "CHECKOUT_STARTED"];

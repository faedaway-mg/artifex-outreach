// ─────────────────────────────────────────────────────────────────────────────
// PURCHASE SAFETY — the single gate EVERY purchase path must pass before a live
// checkout can be created. If any check fails, no checkout is created.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer, OfferState } from "./types";
import { capabilityByKey, isSellable } from "./capabilities";
import { TIER_BY_BAND } from "./pricing";
import { baselinePriceVersions, isApprovedPrice, type PriceVersion } from "./pricing-experiments";
import { buildStripeDescription } from "./stripe-copy";
/**
 * Production live-purchase eligibility gate — an INDEPENDENT deployment switch.
 * Real charges in production stay BLOCKED until QUICKFIX_LEGAL_APPROVED=true (the
 * operator's explicit production approval of the Quick-Fix service terms). This is
 * defense in depth: even with approved terms in code, live charging requires the
 * env switch to be set on the production service. Non-production (dev/test) is not
 * blocked so test-mode rehearsals and the operator preview can run. Returns the
 * blocking reason, or null if allowed.
 */
export function legalGateBlocked(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.QUICKFIX_LEGAL_APPROVED === "true") return null;
  return env.NODE_ENV === "production"
    ? "Live purchases are blocked until the Quick-Fix service terms are approved for production (operator legal review → QUICKFIX_LEGAL_APPROVED=true)."
    : null;
}

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
  /** Approved price versions (active + retired). Defaults to the baseline set. */
  approvedPriceVersions?: PriceVersion[];
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

  // Price validity — must match an APPROVED price version for the band (active or
  // retired-historical). The LLM can never move it to an unapproved amount.
  const versions = input.approvedPriceVersions ?? baselinePriceVersions("");
  if (!TIER_BY_BAND.get(offer.band)) reasons.push(`unknown pricing band ${offer.band}`);
  else if (!isApprovedPrice(offer.band, offer.priceCents, versions)) reasons.push(`price ${offer.priceCents} is not an approved version for band ${offer.band}`);

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

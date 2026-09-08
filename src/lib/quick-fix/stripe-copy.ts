// ─────────────────────────────────────────────────────────────────────────────
// STRIPE / CUSTOMER-FACING COPY — the ONLY text a prospect or Stripe ever sees.
//
// Derived strictly from the APPROVED offer scope. It must never leak internal
// signals: lead scoring, evidence confidence, labor estimates, margins, or private
// analysis. Internal and external representations are kept physically separate —
// this module reads scope only, never economics.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { containsFabricatedClaim } from "./evidence-gate";

export interface StripeDescription {
  /** Stripe product_data.name — short, concrete. */
  productTitle: string;
  /** One-line customer-facing summary. */
  shortDescription: string;
  /** Bulleted scope summary (included items). */
  scopeSummary: string[];
  /** Delivery expectation sentence. */
  deliveryExpectation: string;
  /** True if any generated text tripped the fabrication guard (caller must block). */
  safe: boolean;
}

const MAX_STRIPE_NAME = 250; // Stripe product name limit is generous; keep it tight

export function buildStripeDescription(offer: QuickFixOffer): StripeDescription {
  const productTitle = offer.scope.offerName.slice(0, MAX_STRIPE_NAME);
  const shortDescription = offer.scope.proposedSolution;
  const scopeSummary = offer.scope.includedItems.slice(0, 6);
  const deliveryExpectation = offer.scope.deliveryWindow;

  // Anti-leak + anti-fabrication: none of the external text may contain invented
  // metrics, and (defense in depth) must not contain internal economics tokens.
  const blob = [productTitle, shortDescription, ...scopeSummary, deliveryExpectation].join(" ");
  const leaks = /\b(margin|effective hourly|labor|confidence score|lead score|evidence confidence)\b/i.test(blob);
  const safe = !containsFabricatedClaim(blob) && !leaks;

  return { productTitle, shortDescription, scopeSummary, deliveryExpectation, safe };
}

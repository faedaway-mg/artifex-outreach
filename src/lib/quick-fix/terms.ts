// ─────────────────────────────────────────────────────────────────────────────
// TERMS — lightweight click-accept Service Terms for a quick-fix purchase.
//
// These are PLAIN OPERATIONAL terms describing how the productized fix actually
// works. No LLM-invented legal language. The clauses restate the real process
// (fixed scope/price, access, timing, revisions, third-party limits, refund,
// ownership, authorization). LEGAL_REVIEW_REQUIRED is true: a professional review
// is needed before these are used at scale. Larger/custom/high-risk engagements
// still use the full SignWell agreement flow — this is only for low-ticket fixes.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { QuickFixOffer } from "./types";

export const TERMS_VERSION = "quickfix-terms-v1-2026-09";
export const LEGAL_REVIEW_REQUIRED = true;

/** The operational clauses. Each restates real process behavior — not legalese. */
export const TERMS_CLAUSES: Array<{ heading: string; body: string }> = [
  { heading: "Scope", body: "We will perform exactly the work listed in \"What we'll fix\" for the fixed price shown. Nothing else is implied." },
  { heading: "Exclusions", body: "Anything listed under \"What's not included\" is out of scope and, if you want it, is quoted separately as a new fixed-price offer." },
  { heading: "Payment", body: "The price shown is a one-time flat fee charged at checkout via Stripe. Optional maintenance, if added, is billed monthly until cancelled." },
  { heading: "Required access", body: "You will grant the access listed under \"What we'll need from you\" using each platform's native invite. We never ask for your password." },
  { heading: "Delivery timing", body: "The turnaround shown begins only after we receive the required access and information — not at purchase." },
  { heading: "Revisions", body: "One round of adjustments is included within the window stated in the offer." },
  { heading: "Third-party platforms", body: "We work within the limits of your platform (WordPress, Shopify, Webflow, Squarespace, etc.). Platform-imposed constraints are outside our control." },
  { heading: "Refund / cancellation", body: "If we cannot deliver the agreed scope, you are refunded. Once delivered as scoped, the fee is earned." },
  { heading: "Ownership", body: "On full payment, the delivered changes to your own site/accounts are yours." },
  { heading: "Authorization", body: "By accepting, you confirm you are authorized to approve changes to the specified pages/accounts." },
  { heading: "Scope changes", body: "If we discover something outside the agreed scope, we tell you before doing additional work — no surprise charges." },
  { heading: "Limitation of liability", body: "Our liability for a quick fix is limited to the amount paid for that fix. [Pending legal review.]" },
];

export interface TermsAcceptance {
  termsVersion: string;
  offerId: string;
  offerVersion: string;
  customerEmail: string;
  acceptedAt: string;
  /** Immutable snapshot of exactly what was agreed. */
  scopeSnapshot: {
    offerName: string;
    priceCents: number;
    includedItems: string[];
    excludedItems: string[];
    deliveryWindow: string;
    revisionPolicy: string;
  };
  /** Hash binding the acceptance to the exact scope + terms text. */
  digest: string;
}

export function buildTermsAcceptance(args: { offer: QuickFixOffer; customerEmail: string; acceptedAt: string }): TermsAcceptance {
  const { offer } = args;
  const scopeSnapshot = {
    offerName: offer.scope.offerName,
    priceCents: offer.priceCents,
    includedItems: offer.scope.includedItems,
    excludedItems: offer.scope.excludedItems,
    deliveryWindow: offer.scope.deliveryWindow,
    revisionPolicy: offer.scope.revisionPolicy,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify({ TERMS_VERSION, offerVersion: offer.offerVersion, scopeSnapshot, email: args.customerEmail.toLowerCase() }))
    .digest("hex")
    .slice(0, 24);
  return {
    termsVersion: TERMS_VERSION,
    offerId: offer.offerId,
    offerVersion: offer.offerVersion,
    customerEmail: args.customerEmail,
    acceptedAt: args.acceptedAt,
    scopeSnapshot,
    digest,
  };
}

/** An acceptance is valid for checkout only if it matches the CURRENT offer version. */
export function termsAcceptanceMatchesOffer(acc: TermsAcceptance | null, offer: QuickFixOffer): boolean {
  return !!acc && acc.termsVersion === TERMS_VERSION && acc.offerVersion === offer.offerVersion && acc.offerId === offer.offerId;
}

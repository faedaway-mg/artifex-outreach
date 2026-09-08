// ─────────────────────────────────────────────────────────────────────────────
// OFFER PAGE — the pure view model for the personalized, transactional offer page.
//
// Personalization (finding/evidence/scope/price/requirements/terms) comes from the
// offer. TRUST comes from the shared evergreen ARTIFEX_QUICK_FIX_EXPLAINER, pulled
// by active version — swapping it never regenerates an offer. The customer route
// AND the operator "preview as customer" both render from this one model. Building
// the model triggers no charges and no sends.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import type { EvergreenAssetVersion } from "./evergreen-asset";
import { buildRequirements, type RequirementsChecklist } from "./requirements";
import { buildStripeDescription } from "./stripe-copy";
import { TERMS_VERSION, TERMS_CLAUSES } from "./terms";

// Operationally-true integrity principles (only claims that hold in the process).
export const INTEGRITY_PRINCIPLES = [
  "Fixed scope and fixed price — no surprise charges.",
  "Every recommendation is backed by something we actually observed.",
  "No required sales call to buy.",
  "You see exactly what access we need before you pay.",
  "You stay in control — access is via native invites you can revoke.",
  "If scope materially changes, we ask you first.",
  "The turnaround starts only after you provide what's required.",
];

export interface CheckoutState {
  /** May the buy CTA be shown at all (offer complete + approved)? */
  purchasable: boolean;
  /** Extra conditions for the click itself (Stripe + terms). */
  buyEnabled: boolean;
  reasons: string[];
}

export interface OfferPageModel {
  offerId: string;
  company: string;
  headline: string;
  whatWeFound: string;
  evidence: string[];
  whatWeFix: string[];
  whatsExcluded: string[];
  priceCents: number;
  priceLabel: string;
  turnaround: string;
  trustVideo: { present: boolean; assetUrl: string | null; durationSeconds: number | null; script: string; version: number | null };
  requirements: RequirementsChecklist;
  howItWorks: string[];
  integrityPrinciples: string[];
  termsVersion: string;
  termsClauses: typeof TERMS_CLAUSES;
  maintenance: QuickFixOffer["maintenance"];
  bookingUrl: string;
  checkout: CheckoutState;
  /** Not quick-fix eligible → the page is a conversation page, not a sales page. */
  conversationOnly: boolean;
  conversationReason: string | null;
}

const HOW_IT_WORKS = [
  "Review the exact scope, price, and requirements on this page.",
  "Accept the service terms and check out securely with Stripe.",
  "Complete the short secure checklist so we can access what we need.",
  "We do the work — the turnaround starts once we have everything.",
  "We deliver, you confirm, and we suggest the next logical step (optional).",
];

export interface BuildOfferPageInput {
  offer: QuickFixOffer;
  evergreen: EvergreenAssetVersion | null;
  approved: boolean;
  stripeConfigured: boolean;
  termsAccepted: boolean;
  superseded: boolean;
  bookingUrl: string;
}

export function buildOfferPageModel(input: BuildOfferPageInput): OfferPageModel {
  const { offer } = input;
  const desc = buildStripeDescription(offer);
  const requirements = buildRequirements(offer);

  const conversationOnly = !offer.quickFixEligible;
  const reasons: string[] = [];
  if (conversationOnly) reasons.push("offer is not a fixed-price quick fix");
  if (!input.approved) reasons.push("offer is not yet approved");
  if (input.superseded) reasons.push("a newer version supersedes this offer");
  if (!requirements.items.length) reasons.push("requirements not generated");
  if (!desc.safe) reasons.push("customer-facing copy failed the safety guard");

  const purchasable = reasons.length === 0;
  const buyReasons = [...reasons];
  if (!input.stripeConfigured) buyReasons.push("checkout is not available in this environment");
  if (!input.termsAccepted) buyReasons.push("service terms not accepted yet");
  const buyEnabled = buyReasons.length === 0;

  return {
    offerId: offer.offerId,
    company: offer.companyName,
    headline: conversationOnly ? `Let's talk about ${offer.companyName}` : `${offer.scope.offerName} for ${offer.companyName}`,
    whatWeFound: offer.scope.problemBeingSolved,
    evidence: offer.findingIds.length ? [`Based on ${offer.findingIds.length} evidence-backed finding(s) from our review.`] : [],
    whatWeFix: offer.scope.includedItems,
    whatsExcluded: offer.scope.excludedItems,
    priceCents: offer.priceCents,
    priceLabel: conversationOnly ? "" : `$${Math.round(offer.priceCents / 100)} flat`,
    turnaround: offer.scope.deliveryWindow,
    trustVideo: {
      present: !!input.evergreen,
      assetUrl: input.evergreen?.assetUrl ?? null,
      durationSeconds: input.evergreen?.durationSeconds ?? null,
      script: input.evergreen?.script ?? "",
      version: input.evergreen?.version ?? null,
    },
    requirements,
    howItWorks: HOW_IT_WORKS,
    integrityPrinciples: INTEGRITY_PRINCIPLES,
    termsVersion: TERMS_VERSION,
    termsClauses: TERMS_CLAUSES,
    maintenance: offer.maintenance,
    bookingUrl: input.bookingUrl,
    checkout: { purchasable, buyEnabled, reasons: buyEnabled ? ["ready to check out"] : buyReasons },
    conversationOnly,
    conversationReason: conversationOnly ? offer.notEligibleReason : null,
  };
}

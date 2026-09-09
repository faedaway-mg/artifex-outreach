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
import type { EvidencePackage, AssetStatus } from "./evidence-package";
import type { EvergreenAssetVersion } from "./evergreen-asset";
import { buildRequirements, type RequirementsChecklist } from "./requirements";
import { buildStripeDescription } from "./stripe-copy";
import { TERMS_VERSION, TERMS_CLAUSES } from "./terms";
import { scopeForOffer, type TrustVideoScope } from "./trust-videos";
import { impactForScope } from "./impact";
import { experienceFrameForOffer, type ExperienceFrame } from "./experience-frame";

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
  /** Plain-language proposed change (the offer's proposedSolution) — the "repair" beat. */
  proposedSolution: string;
  /** The offer's revision window/policy, surfaced in the process-protection copy. */
  revisionPolicy: string;
  evidence: string[];
  whatWeFix: string[];
  whatsExcluded: string[];
  priceCents: number;
  priceLabel: string;
  turnaround: string;
  /** Compact hero badges generated from the real offer (scope/turnaround/price). */
  trustBadges: string[];
  /** Qualitative "why this matters" points — approved scope-family template, never metrics. */
  impactPoints: string[];
  /** Conceptual interface before/after (an EXAMPLE — never a measured customer result). */
  beforeAfter: { before: string; after: string };
  scope: TrustVideoScope;
  /** The single source of the attempted-use / observed-friction hero (email + PDF + page
   *  all derive their opener from HERE). Drives the EXPERIENCE hero that leads the page. */
  experience: ExperienceFrame;
  /** The PERSONALIZED diagnostic video slot — placed near the real evidence (after the
   *  screenshots, before "what this means"). `url` is non-null ONLY when status==="READY";
   *  a non-READY status (MISSING/STALE/…) exposes the honest state so the page can show the
   *  status instead of rendering a broken empty frame — and it NEVER falls back to the
   *  evergreen process video (that is a SEPARATE, secondary asset). */
  personalizedVideo: { status: AssetStatus; url: string | null; detail: string };
  /** The SECONDARY, evergreen "how the Artifex quick fix works" explainer — supporting
   *  trust content that lives further down the page. It must NEVER occupy the personalized
   *  slot above and is never presented as being about the customer's own site. */
  trustVideo: { present: boolean; assetUrl: string | null; posterUrl: string | null; captionsUrl: string | null; title: string; durationSeconds: number | null; script: string; version: number | null };
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
  /** The canonical evidence bindings (screenshots/findings/asset refs) for this offer,
   *  when the caller has already built the package. Purely additive; null when omitted. */
  evidenceAssets?: EvidencePackage | null;
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
  /** Recurring-maintenance upsell is only surfaced when the operator has enabled it
   *  (a working online cancellation path is configured). Default off. */
  maintenanceUpsellEnabled?: boolean;
  /** Pre-built evidence package to surface on the page. Purely additive; omit → null. */
  evidence?: EvidencePackage | null;
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

  const scope = scopeForOffer(offer);
  const impact = impactForScope(scope);
  // PERSONALIZED diagnostic video slot — read straight from the ONE evidence truth. The
  // url survives ONLY when the ref is genuinely READY; any other status (MISSING/STALE)
  // exposes the honest state so the page shows status, not a broken empty frame. We NEVER
  // substitute the evergreen process video here. Absent an evidence package → honest MISSING.
  const pvRef = input.evidence?.personalizedVideo ?? null;
  const personalizedVideo: OfferPageModel["personalizedVideo"] =
    pvRef && pvRef.status === "READY" && pvRef.url
      ? { status: "READY", url: pvRef.url, detail: pvRef.detail }
      : {
          status: pvRef?.status ?? "MISSING",
          url: null,
          detail: pvRef?.detail ?? "No personalized diagnostic video has been generated for this offer yet.",
        };
  // The one attempted-use / observed-friction frame that leads the page hero. Derived
  // from the offer's canonical problem statement — never fabricated, honest when the
  // defect doesn't imply an attempt (attemptSupported === false).
  const experience = experienceFrameForOffer(offer);
  // Short turnaround phrase for the hero badge (the full sentence stays in §price).
  const durMatch = offer.scope.deliveryWindow.match(/within\s+([^.,]+?)\s+of/i);
  const shortTurn = durMatch ? `${durMatch[1].trim()} after access` : "Fast turnaround";
  // Hero badges: only claims that are true of every fixed-scope offer, plus the
  // offer's own turnaround. No metrics — these mirror the integrity principles.
  const trustBadges = conversationOnly
    ? []
    : ["Fixed scope", shortTurn, "No surprise charges"];

  return {
    offerId: offer.offerId,
    company: offer.companyName,
    headline: conversationOnly ? `Let's talk about ${offer.companyName}` : `${offer.scope.offerName} for ${offer.companyName}`,
    whatWeFound: offer.scope.problemBeingSolved,
    proposedSolution: offer.scope.proposedSolution,
    revisionPolicy: offer.scope.revisionPolicy,
    evidence: offer.findingIds.length ? [`Based on ${offer.findingIds.length} evidence-backed finding(s) from our review.`] : [],
    whatWeFix: offer.scope.includedItems,
    whatsExcluded: offer.scope.excludedItems,
    priceCents: offer.priceCents,
    priceLabel: conversationOnly ? "" : `$${Math.round(offer.priceCents / 100)} flat`,
    turnaround: offer.scope.deliveryWindow,
    trustBadges,
    impactPoints: impact.impactPoints,
    beforeAfter: { before: impact.before, after: impact.after },
    scope,
    experience,
    personalizedVideo,
    trustVideo: {
      present: !!input.evergreen,
      assetUrl: input.evergreen?.assetUrl ?? null,
      posterUrl: input.evergreen?.posterUrl ?? null,
      captionsUrl: input.evergreen?.captionsUrl ?? null,
      title: input.evergreen?.title ?? "How the Artifex quick fix works",
      durationSeconds: input.evergreen?.durationSeconds ?? null,
      script: input.evergreen?.script ?? "",
      version: input.evergreen?.version ?? null,
    },
    requirements,
    howItWorks: HOW_IT_WORKS,
    integrityPrinciples: INTEGRITY_PRINCIPLES,
    termsVersion: TERMS_VERSION,
    termsClauses: TERMS_CLAUSES,
    maintenance: input.maintenanceUpsellEnabled ? offer.maintenance : null,
    bookingUrl: input.bookingUrl,
    checkout: { purchasable, buyEnabled, reasons: buyEnabled ? ["ready to check out"] : buyReasons },
    conversationOnly,
    conversationReason: conversationOnly ? offer.notEligibleReason : null,
    evidenceAssets: input.evidence ?? null,
  };
}

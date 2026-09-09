// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX SERVICE TERMS (v2) — operator-approved productized service terms.
//
// These customer-facing terms govern the productized Quick-Fix services only
// ($99 / $249 / $495 / $995). Larger/custom engagements remain on the SignWell
// agreement path. The commercial substance was APPROVED BY THE OPERATOR for
// production use (TERMS_OPERATOR_APPROVED). This is operator/business approval —
// it does NOT assert that outside counsel, an attorney, or a law firm reviewed or
// approved these terms. The production live-charge gate is an independent
// deployment switch (QUICKFIX_LEGAL_APPROVED) enforced in purchase-safety.ts.
//
// A new TERMS_VERSION invalidates any prior acceptance for a newly generated
// checkout (termsAcceptanceMatchesOffer), and every acceptance freezes an
// immutable snapshot of the EXACT terms text + scope that the customer agreed to —
// a later version can never retroactively replace that artifact.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { QuickFixOffer } from "./types";

export const TERMS_VERSION = "quickfix-terms-v2-2026-09";

/** Contracting entity for productized Quick-Fix services. */
export const CONTRACTING_ENTITY = "Faedaway M.G. LLC d/b/a Artifex Labs, Los Angeles, California";

/** Operator approved these terms for production use. NOT an assertion of
 *  outside-counsel/attorney review. The independent live-charge deployment gate is
 *  QUICKFIX_LEGAL_APPROVED (see purchase-safety.ts). */
export const TERMS_OPERATOR_APPROVED = true;

/** Back-compat marker. The terms are no longer a pending-review DRAFT — they are
 *  operator-approved. Kept as a boolean for any importer; the meaningful production
 *  live-charge gate is QUICKFIX_LEGAL_APPROVED, not this flag. */
export const LEGAL_REVIEW_REQUIRED = false;

/** The privacy/access notice this agreement references (Section 16). */
export const PRIVACY_NOTICE_PATH = "/legal/privacy";

/** The full customer-facing clause set (approved substance, minor copyediting for
 *  readability). The accepted offer controls service-specific details; these Terms
 *  govern everything else. Where the two conflict on a service-specific issue, the
 *  accepted offer controls. */
export const TERMS_CLAUSES: Array<{ heading: string; body: string }> = [
  { heading: "1. Business use and authority", body: "Quick-Fix services are offered for business and commercial purposes. By purchasing, you represent that you are acting for a business or other commercial organization and have authority to approve the engagement and bind that organization." },
  { heading: "2. Offer and scope", body: "Artifex will perform exactly the work identified in the accepted offer under \"What we'll fix\" for the fixed price shown. No additional work is implied. The accepted offer controls service-specific details — service, price, included work, exclusions, required customer input/access, delivery window, and revision policy. These Service Terms govern everything else. If a service-specific provision of the accepted offer conflicts with these general Terms, the accepted offer controls for that service-specific issue." },
  { heading: "3. Exclusions", body: "Anything identified as excluded or not included is outside the purchased scope. Additional work requires a separate approved scope and price. No surprise charges." },
  { heading: "4. Payment and taxes", body: "The price shown for a one-time Quick-Fix is charged through Stripe at checkout. You are responsible for applicable taxes unless Stripe/Artifex collects them as part of checkout. Optional recurring maintenance is governed separately by the recurring-payment section and requires separate affirmative consent." },
  { heading: "5. Your responsibilities / required access", body: "You are responsible for providing accurate information, timely approvals, required content/materials, required platform access, and authority to use any materials you supply. Access must use platform-native collaborator/invite/authorization systems where available. Artifex does not request your passwords. Delays caused by missing access, information, approvals, or your action pause any delivery timeline." },
  { heading: "6. Delivery timing", body: "Any turnaround shown in an offer begins only after Artifex has received all required access, information, materials, and approvals. Unless an offer expressly says otherwise, quoted turnaround periods are measured in business days. The delivery clock pauses while waiting for your action, access, approvals, or required materials, or for third-party outages, platform review, platform limitations, or circumstances reasonably outside Artifex's control. Turnaround is not guaranteed unless the specific service expressly says so. The Fix Scan targets a 24–48 hour turnaround as an operational target, consistent with the delivery-timing rules above." },
  { heading: "7. Delivery", body: "Work is considered delivered when the agreed change, configuration, report, repair, implementation, or other deliverable has been implemented on the authorized property or otherwise made available to you, and Artifex has notified you that the scoped work is complete." },
  { heading: "8. Revisions", body: "One round of reasonable adjustments is included if requested within the revision window specified by the accepted offer. If the offer does not define a window, the default is seven calendar days after delivery. A revision must remain within the original scope. A revision is not a new feature, redesign, new implementation, unrelated repair, or expansion of the accepted scope." },
  { heading: "9. Scope changes", body: "If Artifex discovers work outside the agreed scope, Artifex will explain it before performing additional work. Additional work requires a new approved scope/offer." },
  { heading: "10. Third-party platforms", body: "Quick-Fix work may depend on WordPress, Shopify, Webflow, Squarespace, hosting providers, APIs, plugins, analytics providers, payment providers, and other third-party software/services. Artifex is not responsible for third-party outages, policy changes, discontinued functionality, review decisions, fees, limitations, or defects outside the purchased scope. Third-party charges are excluded unless explicitly included in the offer." },
  { heading: "11. Backups / production-change risk", body: "Website and platform changes can interact with existing themes, plugins, integrations, hosting, APIs, custom code, and third-party systems. Where reasonably available, Artifex will use appropriate staging, backup, versioning, testing, or rollback practices. You remain responsible for maintaining appropriate backups of your systems and content unless the accepted offer specifically makes Artifex responsible for them." },
  { heading: "12. Cancellation / refunds", body: "If Artifex determines that the agreed scope cannot be delivered, Artifex will cancel the engagement and refund the amount paid for the undelivered service. If you cancel before work begins, Artifex may provide a full refund. If work has already begun, any refund may reflect the portion of the scoped work already performed, subject to applicable law. Once the agreed scope has been completed and delivered, the fee is earned. Nothing in these terms limits rights that cannot legally be waived." },
  { heading: "13. No guaranteed business outcome", body: "Unless expressly included in the accepted offer, Artifex does not guarantee revenue, conversion increases, lead volume, traffic, search rankings, sales, uptime, profitability, or business results. Quick-Fix promises scoped work and evidence-backed completion — not invented business outcomes." },
  { heading: "14. Accessibility / compliance", body: "Accessibility work is limited to the issues and scope identified in the accepted offer. Unless specifically included, accessibility remediation is not a legal opinion, certification, VPAT, Accessibility Conformance Report, or guarantee of compliance with WCAG, ADA, Section 508, or other legal/regulatory requirement." },
  { heading: "15. Ownership", body: "After full payment, you own the customer-specific changes and deliverables created for and incorporated into your property. Artifex retains ownership of its pre-existing or reusable tools, templates, libraries, components, workflows, processes, methods, know-how, systems, and reusable code/materials. If Artifex-owned reusable material is incorporated into a deliverable, you receive a perpetual right to use it as part of that delivered work." },
  { heading: "16. Confidentiality / access / data", body: "Each party will use reasonable care to protect nonpublic information received for the engagement. Artifex will use your information only as reasonably necessary to perform the service, administer the engagement, provide support, and maintain required business/payment/acceptance records. Artifex uses platform-native collaborator access where possible and does not ask you to provide account passwords. Payment card information is handled by Stripe and is not stored by Artifex. See the Artifex privacy notice for details." },
  { heading: "17. Authorization", body: "You represent that you own, administer, or have sufficient authority over every website, account, system, page, content item, and property you ask Artifex to modify, and you authorize Artifex to make the scoped changes to those properties." },
  { heading: "18. Limitation of liability", body: "To the maximum extent permitted by law, neither party will be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenue, data, or business opportunities arising from a Quick-Fix engagement. Artifex's aggregate liability arising from a particular Quick-Fix engagement will not exceed the amount paid for that engagement. These limitations do not apply where applicable law does not permit them." },
  { heading: "19. Electronic acceptance / entire agreement", body: "Electronic click acceptance is binding to the accepted terms version and offer version. The accepted offer, its immutable scope snapshot, these terms, and any recurring-maintenance consent constitute the agreement for that Quick-Fix engagement. Changes require a new accepted version." },
  { heading: "20. General", body: "These terms are governed by the laws of the State of California, and the venue for any dispute is Los Angeles County, California. If any provision is held unenforceable, the remaining provisions stay in effect. A failure to enforce a provision is not a waiver. Neither party is liable for delays or failures caused by circumstances reasonably outside its control (force majeure). You agree to receive engagement communications electronically. Artifex may assign these terms to a successor to its business; you may not assign without Artifex's consent. The payment, ownership, confidentiality, and limitation-of-liability provisions survive completion of the engagement." },
];

/** Deterministic, human-readable rendering of the EXACT terms document a customer
 *  agreed to. Frozen into every acceptance so the artifact can never be retroactively
 *  changed by a later terms version. */
export function renderTermsDocument(): string {
  const header = [
    `Artifex Quick-Fix — Service Terms`,
    `Version: ${TERMS_VERSION}`,
    `Contracting entity: ${CONTRACTING_ENTITY}`,
    "",
  ].join("\n");
  const body = TERMS_CLAUSES.map((c) => `${c.heading}\n${c.body}`).join("\n\n");
  return `${header}${body}\n`;
}

/** SHA-256 of the rendered terms document (proves which exact text was shown). */
export function termsDocumentSha(): string {
  return createHash("sha256").update(renderTermsDocument()).digest("hex");
}

export interface TermsAcceptance {
  termsVersion: string;
  contractingEntity: string;
  offerId: string;
  offerVersion: string;
  customerEmail: string;
  acceptedAt: string;
  /** The SKU/service accepted (primary bundled capability). */
  service: string;
  /** Immutable snapshot of exactly what was agreed. */
  scopeSnapshot: {
    offerName: string;
    priceCents: number;
    includedItems: string[];
    excludedItems: string[];
    deliveryWindow: string;
    revisionPolicy: string;
  };
  /** The frozen full terms text + its hash — the artifact the customer accepted. */
  termsDocument: string;
  termsDocumentSha: string;
  /** SHA-256 digest binding the acceptance to the exact terms + scope + identity. */
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
  const termsDocument = renderTermsDocument();
  const docSha = createHash("sha256").update(termsDocument).digest("hex");
  const service = offer.capabilityKeys[0] ?? "";
  const digest = createHash("sha256")
    .update(JSON.stringify({
      entity: CONTRACTING_ENTITY,
      termsVersion: TERMS_VERSION,
      termsDocumentSha: docSha,
      offerId: offer.offerId,
      offerVersion: offer.offerVersion,
      service,
      scopeSnapshot,
      email: args.customerEmail.toLowerCase(),
      acceptedAt: args.acceptedAt,
    }))
    .digest("hex");
  return {
    termsVersion: TERMS_VERSION,
    contractingEntity: CONTRACTING_ENTITY,
    offerId: offer.offerId,
    offerVersion: offer.offerVersion,
    customerEmail: args.customerEmail,
    acceptedAt: args.acceptedAt,
    service,
    scopeSnapshot,
    termsDocument,
    termsDocumentSha: docSha,
    digest,
  };
}

/** An acceptance is valid for checkout only if it matches the CURRENT offer version. */
export function termsAcceptanceMatchesOffer(acc: TermsAcceptance | null, offer: QuickFixOffer): boolean {
  return !!acc && acc.termsVersion === TERMS_VERSION && acc.offerVersion === offer.offerVersion && acc.offerId === offer.offerId;
}

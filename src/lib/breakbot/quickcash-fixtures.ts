// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT QUICK-CASH PRE-FLIGHT FIXTURES — golden + failure journeys.
//
// SELF-CONTAINED + SAFE. Every fixture owns its full artifact set (offer + canonical
// evidence package + the assisted observations) so the pre-flight engine runs with NO
// store, NO repo, NO provider, NO real customer. Companies are fake; recipients are
// under the reserved non-deliverable RESERVED_TEST_DOMAIN (example.invalid — no MX);
// provenance mirrors the breakbot isolation guard (isolation.ts). A fixture can never
// affect real customers, revenue, the sprint, reference inventory, or the send queue.
//
// The 5 GOLDEN fixtures are fully-formed, evidence-backed, delayed-price journeys that
// SHOULD pass (overall READY). The 20 FAILURE fixtures each introduce exactly ONE real
// strategy violation and are annotated with the EXACT blocker surface Breakbot must emit.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { QuickFixOffer, OfferEconomics } from "../quick-fix/types";
import type {
  EvidencePackage,
  EvidenceFinding,
  EvidenceScreenshot,
  EvidenceAssetRef,
  AssetStatus,
} from "../quick-fix/evidence-package";
import { evidenceVersion, type DependentAsset } from "../quick-fix/evidence-truth";
import { experienceFrameForOffer } from "../quick-fix/experience-frame";
import {
  trustVideoForOffer,
  TRUST_VIDEO_NARRATION_VERSION,
  type TrustVideoAsset,
} from "../quick-fix/trust-videos";
import type { BreakbotPreflightInput } from "./quickcash-preflight";
import { RESERVED_TEST_DOMAIN, BREAKBOT_PROVENANCE, assertFakeRecipient } from "./isolation";

// ── Reserved, non-deliverable identifiers ────────────────────────────────────
const R = (slug: string) => `ops+${slug}@${RESERVED_TEST_DOMAIN}`;
/** All fixtures share this synthetic provenance — the production boundary rejects it. */
export const FIXTURE_PROVENANCE = BREAKBOT_PROVENANCE;

// ── Base economics (internal; never customer-facing) ─────────────────────────
function economics(priceCents: number): OfferEconomics {
  return {
    priceCents,
    estimatedHours: 2,
    externalCostCents: 0,
    grossContributionCents: priceCents,
    effectiveHourlyCents: Math.round(priceCents / 2),
    deliveryRisk: "low",
    supportBurden: "low",
    clearsMarginGate: true,
    marginReasons: ["fixed low-risk scope"],
  };
}

// ── A finding derived (shape-compatible) the SAME way evidence-package builds them ──
function finding(over: Partial<EvidenceFinding> & { id: string }): EvidenceFinding {
  return {
    id: over.id,
    observation: over.observation ?? "While reviewing your site, we noticed the main booking button was hard to find.",
    plain: over.plain ?? "Your main booking button was hard to find on the pages we checked.",
    whyItMatters: over.whyItMatters ?? "Visitors who want to book may leave before finding how.",
    confidenceLabel: over.confidenceLabel ?? "Observed",
    confidenceScore: over.confidenceScore ?? 0.86,
    screenshotId: over.screenshotId ?? "lead:desktop",
  };
}

function screenshot(over: Partial<EvidenceScreenshot> & { id: string; viewport: "mobile" | "desktop" }): EvidenceScreenshot {
  return {
    id: over.id,
    imageRoute: over.imageRoute ?? `/api/content-studio/screenshot-image?business=lead&viewport=${over.viewport}`,
    publicUrl: null,
    viewport: over.viewport,
    pageLabel: over.pageLabel ?? (over.viewport === "mobile" ? "Your homepage on a phone" : "Your homepage on a computer"),
    sourceUrl: over.sourceUrl ?? "https://fixture.example",
    capturedAt: over.capturedAt ?? "2026-09-01T00:00:00.000Z",
    sha256: over.sha256 ?? "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888",
    status: over.status ?? "READY",
  };
}

// ── The canonical GOLDEN offer (booking issue, evidence-backed, delayed price) ──
export interface OfferOverrides {
  offerId?: string;
  leadId?: string;
  companyName?: string;
  capabilityKeys?: string[];
  priceCents?: number;
  problemBeingSolved?: string;
  proposedSolution?: string;
  includedItems?: string[];
  quickFixEligible?: boolean;
}

export function goldenOffer(o: OfferOverrides = {}): QuickFixOffer {
  const offerId = o.offerId ?? "bb_off_booking";
  const leadId = o.leadId ?? "lead";
  const priceCents = o.priceCents ?? 30000;
  const included = o.includedItems ?? [
    "Move the main booking button to the top of the page where visitors see it first",
    "Fix the button so it works on phones",
    "Check everything works on computer and phone after the change goes live",
  ];
  return {
    offerId,
    leadId,
    companyName: o.companyName ?? "Northstar Hospitality",
    findingIds: ["f-booking"],
    capabilityKeys: o.capabilityKeys ?? ["cta-repair"],
    band: "ENTRY",
    priceCents,
    currency: "usd",
    scope: {
      offerName: "Booking Button Repair",
      problemBeingSolved: o.problemBeingSolved ?? "The main way to book online was hard to find on the pages we checked.",
      proposedSolution: o.proposedSolution ?? "Move and repair the booking button so visitors can book without hunting for it.",
      includedItems: included,
      excludedItems: ["Full homepage redesign", "New logo and brand look"],
      customerInputsRequired: ["Website editor access"],
      deliveryWindow: "Delivered within 48 hours of receiving access",
      revisionPolicy: "One round of adjustments within 7 days of delivery.",
    },
    evidenceGrade: "OBSERVED",
    confidence: 0.86,
    rationale: "Observed booking friction; low-risk CTA repair at the entry band.",
    economics: economics(priceCents),
    maintenance: null,
    quickFixEligible: o.quickFixEligible ?? true,
    notEligibleReason: null,
    automationLevel: "ASSISTED",
    offerVersion: "v1",
    state: "DRAFT",
    generatedAt: "2026-09-01T00:00:00.000Z",
  };
}

export interface PackageOverrides {
  offerId?: string;
  leadId?: string;
  company?: string;
  findings?: EvidenceFinding[];
  screenshots?: EvidenceScreenshot[];
  screenshotStatus?: AssetStatus;
  personalizedVideo?: EvidenceAssetRef;
  diagnosticPdf?: EvidenceAssetRef;
  evergreenVideo?: EvidenceAssetRef;
  evidenceGrade?: string;
}

export function goldenPackage(offer: QuickFixOffer, o: PackageOverrides = {}): EvidencePackage {
  const findings = o.findings ?? [finding({ id: "f-booking" })];
  return {
    offerId: o.offerId ?? offer.offerId,
    leadId: o.leadId ?? offer.leadId,
    company: o.company ?? offer.companyName,
    websiteUrl: "https://fixture.example",
    screenshots: o.screenshots ?? [
      screenshot({ id: "lead:desktop", viewport: "desktop" }),
      screenshot({ id: "lead:mobile", viewport: "mobile" }),
    ],
    screenshotStatus: o.screenshotStatus ?? "READY",
    findings,
    personalizedVideo: o.personalizedVideo ?? { status: "MISSING", url: null, detail: "No personalized-video pipeline exists." },
    diagnosticPdf: o.diagnosticPdf ?? { status: "READY", url: `/api/quick-fix/${offer.offerId}/diagnostic-pdf`, detail: "On-demand diagnostic PDF." },
    evergreenVideo: o.evergreenVideo ?? { status: "READY", url: "/trust-videos/cta-conversion-v2.mp4", detail: "Shared evergreen explainer." },
    confidence: offer.confidence,
    evidenceGrade: o.evidenceGrade ?? offer.evidenceGrade,
    generatedAt: offer.generatedAt,
  };
}

// ── Default "everything is safe" assisted observations ───────────────────────
export function safeApproval(evVersion: string) {
  return {
    sendsCausedByApprove: 0,
    schedulesCausedByApprove: 0,
    sendIsExplicit: true,
    scheduleIsExplicit: true,
    approvedEvidenceVersion: evVersion,
  };
}
export function safeCheckout(offer: QuickFixOffer) {
  return {
    checkoutSku: offer.capabilityKeys[0] ?? null,
    checkoutPriceCents: offer.priceCents,
    managedPayments: false,
    webhookAuthoritative: true,
    liveCharge: false,
  };
}
export function safeFulfillment() {
  return {
    detectedPlatform: "wordpress",
    jobState: "PAID" as const,
    accessReceived: true,
    preChangeCaptured: true,
    customer: null,
    customerPortalPresent: true,
    termsVersion: "terms.v1",
  };
}

/** Assemble a fully-safe preflight input for an offer (the READY baseline). */
export function baseInput(offer: QuickFixOffer, pkgOver: PackageOverrides = {}): BreakbotPreflightInput {
  const evidence = goldenPackage(offer, pkgOver);
  const ev = evidenceVersion(evidence);
  const videoAsset = trustVideoForOffer(offer).asset;
  const dependentAssets: DependentAsset[] = [
    { kind: "diagnosticPdf", present: evidence.diagnosticPdf.status === "READY", generatedEvidenceVersion: ev },
  ];
  return {
    offer,
    evidence,
    dependentAssets,
    evergreen: null,
    approvedSubject: null,
    videoAsset,
    screenshotsRequired: false,
    approval: safeApproval(ev),
    checkout: safeCheckout(offer),
    demo: { isDemo: false, countedTowardRevenue: false },
    fulfillment: safeFulfillment(),
    operatorView: { websiteUrl: "https://fixture.example", legacyFrozenShownActive: false },
    sellable: offer.quickFixEligible,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN FIXTURES (Q) — expect READY (except the passive-observation one, which is
// READY too; the point there is that the fallback copy avoids "I tried").
// ─────────────────────────────────────────────────────────────────────────────
export interface GoldenFixture {
  id: string;
  label: string;
  recipient: string;
  provenance: string;
  input: BreakbotPreflightInput;
  expectReady: true;
}

function golden(id: string, slug: string, label: string, input: BreakbotPreflightInput): GoldenFixture {
  const recipient = R(slug);
  assertFakeRecipient(recipient);
  return { id, label, recipient, provenance: FIXTURE_PROVENANCE, input, expectReady: true };
}

export function goldenFixtures(): GoldenFixture[] {
  // 1) Booking issue — full, evidence-backed, delayed price.
  const booking = baseInput(goldenOffer());

  // 2) Contact form — a website-inquiry subject family.
  const contactOffer = goldenOffer({
    offerId: "bb_off_contact",
    companyName: "Cedar Grove Dental",
    capabilityKeys: ["contact-form-repair"],
    problemBeingSolved: "The contact form on your website did not appear to submit on the pages we checked.",
    proposedSolution: "Repair the contact form so inquiries actually reach your inbox.",
    includedItems: [
      "Fix the contact form when submissions are failing",
      "Confirm that submissions land in your inbox",
      "Make sure the form is easy to use on a phone",
    ],
  });
  const contact = baseInput(contactOffer, { findings: [finding({ id: "f-booking", observation: "The contact form did not submit.", plain: "Your contact form did not submit on the pages we checked.", whyItMatters: "Inquiries may never reach you." })] });
  contact.fulfillment = { ...safeFulfillment() };

  // 3) Mobile issue.
  const mobileOffer = goldenOffer({
    offerId: "bb_off_mobile",
    companyName: "Vertex Roofing",
    capabilityKeys: ["mobile-layout-fix"],
    problemBeingSolved: "On a phone, the layout broke and the booking button was hard to use.",
    proposedSolution: "Correct the mobile layout so the important actions stay usable on a phone.",
    includedItems: [
      "Correct the mobile layout so content and buttons stay usable",
      "Check the important actions work across common phone sizes",
    ],
  });
  const mobile = baseInput(mobileOffer, { findings: [finding({ id: "f-booking", observation: "On mobile the layout broke.", plain: "On a phone, the layout broke on the pages we checked.", whyItMatters: "Most visitors are on phones.", screenshotId: "lead:mobile" })] });

  // 4) Passive-observation only (readability) — attemptSupported=false; verify no "I tried".
  const passiveOffer = goldenOffer({
    offerId: "bb_off_passive",
    companyName: "Riverside Bakery",
    capabilityKeys: ["accessibility-quickfix"],
    problemBeingSolved: "Some of the text on your website was hard to read on the pages we checked.",
    proposedSolution: "Improve the text contrast and size so the content is easy to read.",
    includedItems: [
      "Improve the text contrast so it is easy to read",
      "Increase small text to a comfortable size",
    ],
  });
  const passive = baseInput(passiveOffer, { findings: [finding({ id: "f-booking", observation: "Some text was hard to read.", plain: "Some of the text was hard to read on the pages we checked.", whyItMatters: "Hard-to-read text loses visitors." })] });

  // 5) Fully-ready customer journey (same as #1 but with a store-backed operator view).
  const ready = baseInput(goldenOffer({ offerId: "bb_off_ready", companyName: "Summit Auto Care" }));

  return [
    golden("bb_gold_booking", "gold-booking", "Booking issue — full evidence, delayed price", booking),
    golden("bb_gold_contact", "gold-contact", "Contact form — website-inquiry subject", contact),
    golden("bb_gold_mobile", "gold-mobile", "Mobile layout issue", mobile),
    golden("bb_gold_passive", "gold-passive", "Passive observation only — no 'I tried'", passive),
    golden("bb_gold_ready", "gold-ready", "Fully-ready customer journey", ready),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// FAILURE FIXTURES (R) — each introduces ONE violation → EXACT expected blocker.
// ─────────────────────────────────────────────────────────────────────────────
export interface FailureFixture {
  id: string;
  label: string;
  recipient: string;
  provenance: string;
  input: BreakbotPreflightInput;
  /** The EXACT blocker surface the engine must emit. */
  expectBlockerSurface: string;
}

function fail(id: string, slug: string, label: string, expectBlockerSurface: string, mutate: (i: BreakbotPreflightInput) => BreakbotPreflightInput): FailureFixture {
  const recipient = R(slug);
  assertFakeRecipient(recipient);
  const input = mutate(baseInput(goldenOffer({ offerId: `bb_fail_${slug}`, leadId: `lead_${slug}` })));
  return { id, label, recipient, provenance: FIXTURE_PROVENANCE, input, expectBlockerSurface };
}

/** Recompute evidence version + dependent stamps after mutating the package. */
function restampPdf(i: BreakbotPreflightInput, generatedEvidenceVersion: string | null, present = true): BreakbotPreflightInput {
  return {
    ...i,
    dependentAssets: [{ kind: "diagnosticPdf", present, generatedEvidenceVersion }],
  };
}

export function failureFixtures(): FailureFixture[] {
  const staleVer = "ev1_deadbeefdeadbeef"; // a version that will never match current evidence

  return [
    // 1) STALE SCREENSHOT — recapture changed the evidence; PDF stamped against the old one.
    fail("bb_fail_stale_shot", "stale-shot", "Stale screenshot → PDF stale", "pdf.stale", (i) =>
      restampPdf(i, staleVer)),

    // 2) STALE VIDEO — a bound video whose narration version is stale but marked verified.
    fail("bb_fail_stale_video", "stale-video", "Stale video captions verified against old narration", "video.captionsStale", (i) => ({
      ...i,
      videoAsset: staleCaptionAsset(i, true),
    })),

    // 3) STALE PDF — PDF present but unstamped (cannot prove currency).
    fail("bb_fail_stale_pdf", "stale-pdf", "Unstamped PDF cannot prove currency", "pdf.stale", (i) =>
      restampPdf(i, null)),

    // 4) VIDEO WRONG BUSINESS — a video bound to a different scope.
    fail("bb_fail_video_wrong", "video-wrong", "Video bound to a different scope", "video.binding", (i) => ({
      ...i,
      videoAsset: { ...trustVideoForOffer({ capabilityKeys: ["analytics-install"] }).asset },
    })),

    // 5) PDF WRONG BUSINESS — evidence package bound to another offer/lead.
    fail("bb_fail_pdf_wrong", "pdf-wrong", "PDF evidence bound to another business", "pdf.wrongBusiness", (i) => {
      const evidence = { ...i.evidence, offerId: "someone_else", leadId: "other_lead" };
      const ev = evidenceVersion(evidence);
      return { ...i, evidence, dependentAssets: [{ kind: "diagnosticPdf", present: true, generatedEvidenceVersion: ev }] };
    }),

    // 6) UNSUPPORTED "I tried to submit" — observational defect claiming an attempt.
    fail("bb_fail_false_attempt", "false-attempt", "Unsupported 'I tried to submit' on observational defect", "attemptedUse", () => {
      const offer = goldenOffer({
        offerId: "bb_fail_false-attempt",
        leadId: "lead_false-attempt",
        capabilityKeys: ["accessibility-quickfix"],
        problemBeingSolved: "Some of the text on your website was hard to read on the pages we checked.",
        proposedSolution: "Improve the text so it is easy to read.",
        includedItems: ["Improve the text contrast so it is easy to read"],
      });
      const base = baseInput(offer, { findings: [finding({ id: "f-booking", observation: "text hard to read", plain: "Text was hard to read." })] });
      // Inject an 'I tried to submit…' claim onto a customer-visible surface. The defect is
      // observational (readability, attemptSupported=false) so this must trip attemptedUse.
      return { ...base, extraCustomerCopy: ["I tried to submit your form and it did not work."] };
    }),

    // 7) RAW OFFER URL IN EMAIL.
    fail("bb_fail_raw_offer_url", "raw-offer", "Raw offer URL leaked into the email body", "rawUrl.email", (i) =>
      injectEmailRawUrl(i, "https://artifex.example/offer/abc123")),

    // 8) RAW CAL URL IN EMAIL.
    fail("bb_fail_raw_cal_url", "raw-cal", "Raw Cal booking URL leaked into the email body", "rawUrl.email", (i) =>
      injectEmailRawUrl(i, "https://cal.com/artifex/intro")),

    // 9) CTA ACRONYM IN CUSTOMER COPY.
    fail("bb_fail_cta_acronym", "cta-acronym", "Unexplained CTA acronym in customer copy", "customerLanguage", () => {
      const offer = goldenOffer({
        offerId: "bb_fail_cta-acronym",
        leadId: "lead_cta-acronym",
        includedItems: ["Fix the CTA so visitors can act", "Check everything works on phone"],
      });
      return baseInput(offer);
    }),

    // 10) PRICE DOMINATES HERO — offer page opens with price.
    fail("bb_fail_price_hero", "price-hero", "Price dominates the offer hero", "openingFrame", (i) => ({
      ...i,
      offerPageBlocksOverride: [
        "$300 flat — book your fix now",
        i.offer.scope.problemBeingSolved,
        i.offer.scope.proposedSolution,
        ...i.offer.scope.includedItems,
      ],
    })),

    // 11) PRICE MISSING UNTIL STRIPE — price not visible before purchase.
    fail("bb_fail_price_hidden", "price-hidden", "Price hidden until Stripe", "priceVisibility", (i) => ({
      ...i,
      priceVisibleBeforePurchaseOverride: false,
    })),

    // 12) OFFER PRICE ≠ CHECKOUT PRICE.
    fail("bb_fail_price_mismatch", "price-mismatch", "Offer price ≠ checkout price", "checkout.match", (i) => ({
      ...i,
      checkout: { ...safeCheckout(i.offer), checkoutPriceCents: i.offer.priceCents + 5000 },
    })),

    // 13) APPROVAL SILENTLY SCHEDULES.
    fail("bb_fail_appr_schedule", "appr-schedule", "Approval silently schedules a send", "approval.sideEffects", (i) => ({
      ...i,
      approval: { ...safeApproval(evidenceVersion(i.evidence)), schedulesCausedByApprove: 1 },
    })),

    // 14) APPROVAL SILENTLY SENDS.
    fail("bb_fail_appr_send", "appr-send", "Approval silently sends", "approval.sideEffects", (i) => ({
      ...i,
      approval: { ...safeApproval(evidenceVersion(i.evidence)), sendsCausedByApprove: 1 },
    })),

    // 15) MISSING WEBSITE LINK IN OPERATOR VIEW.
    fail("bb_fail_no_website", "no-website", "Operator view missing website link", "operator.websiteLink", (i) => ({
      ...i,
      operatorView: { websiteUrl: null, legacyFrozenShownActive: false },
    })),

    // 16) LEGACY FROZEN SHOWN ACTIVE.
    fail("bb_fail_legacy_active", "legacy-active", "Legacy frozen record shown as active", "operator.legacyFrozen", (i) => ({
      ...i,
      operatorView: { websiteUrl: "https://fixture.example", legacyFrozenShownActive: true },
    })),

    // 17) DEMO COUNTED TOWARD REVENUE.
    fail("bb_fail_demo_revenue", "demo-revenue", "Demo order counted toward revenue", "revenue.demoCounted", (i) => ({
      ...i,
      demo: { isDemo: true, countedTowardRevenue: true },
    })),

    // 18) CAPTIONS VERIFIED AFTER NARRATION CHANGED.
    fail("bb_fail_caption_narr", "caption-narr", "Captions verified after narration changed", "video.captionsStale", (i) => ({
      ...i,
      videoAsset: staleCaptionAsset(i, true),
    })),

    // 19) OFFER EVIDENCE FROM ANOTHER BUSINESS (email opener won't match this offer's frame).
    fail("bb_fail_evidence_other", "evidence-other", "Offer evidence from another business", "pdf.wrongBusiness", (i) => {
      const evidence = { ...i.evidence, offerId: "bb_off_other", leadId: "other_business" };
      const ev = evidenceVersion(evidence);
      return { ...i, evidence, dependentAssets: [{ kind: "diagnosticPdf", present: true, generatedEvidenceVersion: ev }] };
    }),

    // 20) SELLABLE OFFER WITH NO FULFILLMENT PATH (unknown platform + unsupported SKU).
    fail("bb_fail_no_fulfillment", "no-fulfillment", "Sellable offer with no fulfillment path", "fulfillment.noPath", (i) => {
      const offer = goldenOffer({
        offerId: "bb_fail_no-fulfillment",
        leadId: "lead_no-fulfillment",
        capabilityKeys: ["unsupported-sku-xyz"],
      });
      const base = baseInput(offer);
      return { ...base, sellable: true, fulfillment: { ...safeFulfillment(), detectedPlatform: "unknown" } };
    }),
  ];
}

// ── Helpers to inject specific violations after the base input is built ──────────
function injectEmailRawUrl(i: BreakbotPreflightInput, url: string): BreakbotPreflightInput {
  // Raw URLs are checked on the artifact's emailBody. The real composer never emits a raw
  // URL, so we hand Breakbot an email body that leaked one (as if a hand-edit introduced it)
  // via the legitimate emailBodyOverride hook. The body opens with the EXACT experience-frame
  // opener so the ONLY violation is the raw URL — the check must catch it on rawUrl.email.
  const opener = experienceFrameForOffer(i.offer).emailOpener;
  const leaked = `${opener}\n\nSee what I found → ${url}\n\nJordan Jackson`;
  return { ...i, emailBodyOverride: leaked };
}

function staleCaptionAsset(i: BreakbotPreflightInput, verified: boolean): TrustVideoAsset {
  const base = trustVideoForOffer(i.offer).asset;
  return {
    ...base,
    captionsUrl: verified ? `/trust-videos/${base.scope}-v${base.version}.vtt` : base.captionsUrl,
    captionsVerified: verified,
    // Mark the narration as a DIFFERENT (older) version than the current one → stale verification.
    narrationVersion: verified ? "qf-narration-v1-original-2026-07" : TRUST_VIDEO_NARRATION_VERSION,
  };
}

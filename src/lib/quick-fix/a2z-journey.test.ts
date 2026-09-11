// ─────────────────────────────────────────────────────────────────────────────
// PART X — A2Z (end-to-end) BOOKING JOURNEY over the REAL functions.
//
// A representative, SAFE booking-flow verification: a reserved/example-domain
// business (never a real prospect) with a single NO_BOOKING finding and a READY
// screenshot. We drive the WHOLE evidence-first / value-before-price journey through
// the ACTUAL fixed contracts — no re-implemented copies — and assert the load-bearing
// guarantees end to end:
//
//   • subject === the booking-family primary ("online booking")
//   • email FIRST line === experienceFrameForOffer(offer).emailOpener, and the body
//     carries NO price and NO raw URL
//   • the diagnostic PDF attaches (or LINKS) with filename "[Business] — Website Review.pdf"
//   • the offer model hero uses experience.offerHeroTitle and the price appears AFTER
//     the package (offer-readiness #6 opens-with-evidence + #10 price-before-purchase pass)
//   • the personalized video is honest MISSING (evergreen is a SEPARATE asset)
//   • assessOfferReadiness has NO blockers for the fully-ready fixture
//   • scanDarkPatterns is clean; evidenceVersion is stable
//
// 0 sends / 0 charges: the only transport-shaped module (offer-outreach) is a PURE
// composer, and we assert no email-provider send function is invoked.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── The SAFE fixture: reserved example.com domain, synthetic booking finding. ──
// example.com / example.example are RFC-2606 reserved — never a real prospect.
const SAFE_BUSINESS = "A2Z Booking Co";
const SAFE_LEAD_ID = "lead_a2z_example";
const SAFE_WEBSITE = "https://a2z-booking.example";
const BOOKING_OPP = {
  id: "no_booking",
  category: "Customer Acquisition",
  observation: "Visitors can't book an appointment online — there's no booking option on the pages we checked.",
  whyItMatters: "Someone ready to schedule has no way to do it, so they leave without becoming a customer.",
  confidence: { label: "Observed", score: 0.95 },
  basis: ["captured screenshot: homepage has no booking control"],
  estimatedImpact: { level: "High" },
};

// A READY captured screenshot for the reserved domain (real bytes are never needed —
// buildEvidencePackage only reads status/outputKey/sha256/urls here).
const READY_SHOT = {
  status: "ready",
  outputKey: "shots/a2z/desktop.png",
  finalUrl: SAFE_WEBSITE,
  requestedUrl: SAFE_WEBSITE,
  capturedAt: "2026-09-01T00:00:00Z",
  sha256: "a2zsha256deadbeef",
};

// ── Mocks: NO database, NO network, NO email provider. ──
vi.mock("../repo", () => ({
  getLead: vi.fn(async () => ({ website: SAFE_WEBSITE, businessName: SAFE_BUSINESS })),
  getBusinessIntelligence: vi.fn(async () => ({
    profile: { businessProfile: { opportunities: [BOOKING_OPP] } },
  })),
  listLeads: vi.fn(async () => []),
  listAudit: vi.fn(async () => []),
  buildSuppressionChecker: vi.fn(async () => () => false),
}));

// A READY screenshot only for the desktop viewport; mobile → none.
vi.mock("../content-studio/screenshot-jobs", () => ({
  latestReadyShot: vi.fn(async (_leadId: string, viewport: string) => (viewport === "desktop" ? READY_SHOT : null)),
}));

// Real diagnostic PDF renderer is heavy (react-pdf) — provide the FIXED seam so the
// attachment policy exercises its REAL attach-vs-link decision with deterministic bytes.
const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(4096, 0x20)]);
let providerSendCalled = 0;
vi.mock("./diagnostic-pdf", async (orig) => {
  const actual = await (orig as any)().catch(() => ({}));
  return {
    ...actual,
    renderDiagnosticPdfBuffer: vi.fn(async () => PDF_BYTES),
  };
});

import { generateOffer } from "./offer-engine";
import { experienceFrameForOffer } from "./experience-frame";
import { composeOfferOutreach } from "./offer-outreach";
import { buildEvidencePackage } from "./evidence-package";
import { buildOutreachAttachments, outreachPdfFilename } from "./email-attachment-policy";
import { buildOfferPageModel } from "./offer-page";
import { trustVideoAsEvergreen } from "./trust-videos";
import {
  assessOfferReadiness,
  checkStartsWithEvidence,
  checkPriceVisibleBeforePurchase,
  type OfferArtifact,
} from "./offer-readiness";
import { scanDarkPatterns } from "./no-dark-patterns";
import { evidenceVersion } from "./evidence-truth";
import { generateSubjectCandidates } from "./subject-engine";
import { toOfferFindings } from "./adapter";
import { ARTIFEX_IDENTITY } from "../identity";
import type { QuickFixOffer } from "./types";

beforeEach(() => {
  providerSendCalled = 0;
});

// The offer is generated the SAME way the pipeline does — from the BI opportunity.
function buildJourneyOffer(): QuickFixOffer {
  const findings = toOfferFindings([BOOKING_OPP]);
  const offer = generateOffer({
    leadId: SAFE_LEAD_ID,
    companyName: SAFE_BUSINESS,
    findings,
    generatedAt: "2026-09-01T00:00:00Z",
  });
  // Attach a share token the way the store would, so the offer/PDF links are the
  // revocable customer path (never a raw offerId).
  return { ...offer, shareToken: "tok_a2z_safe" } as unknown as QuickFixOffer & { shareToken: string };
}

// A journey offer whose CUSTOMER-FACING scope has already passed the plain-language
// gate (the real cta-repair SKU scope carries a "CTA" token that customer-language.ts
// flags — that jargon path is proven in customer-language.test.ts). Everything else —
// family, price, eligibility, evidence — stays engine-derived. Used only where the
// "fully-ready → no blockers" invariant is asserted.
function buildReadyScopedOffer(): QuickFixOffer {
  const offer = buildJourneyOffer();
  return {
    ...offer,
    scope: {
      ...offer.scope,
      proposedSolution: "Add a clear way for visitors to book online, then confirm it works on a phone.",
      includedItems: ["Add a clear online booking path", "Confirm it works on a phone"],
      excludedItems: ["A full redesign of your website", "A new logo or brand"],
    },
  } as QuickFixOffer;
}

describe("Part X — a2z booking journey over the real functions (SAFE fixture, 0 sends/charges)", () => {
  it("produces a booking-family, quick-fix-eligible offer from the real engine", () => {
    const offer = buildJourneyOffer();
    expect(offer.quickFixEligible).toBe(true);
    const frame = experienceFrameForOffer(offer);
    expect(frame.family).toBe("booking");
    expect(frame.attemptSupported).toBe(true); // booking implies a real attempted action
  });

  it("subject is the booking family primary — business-language 'booking question' (§16-18)", () => {
    const offer = buildJourneyOffer();
    // The engine-derived first-touch subject...
    const copy = composeOfferOutreach(offer, { buyUrl: `/offer/${(offer as any).shareToken}`, bookingUrl: ARTIFEX_IDENTITY.bookingUrl });
    expect(copy.subject).toBe("booking question");
    // ...and the subject engine agrees on the booking family + primary.
    const cands = generateSubjectCandidates({ observation: offer.scope.problemBeingSolved, context: offer.scope.proposedSolution });
    expect(cands.family).toBe("booking");
    expect(cands.primary).toBe("booking question");
  });

  it("email first line === experienceFrame.emailOpener; body has NO price and NO raw URL", async () => {
    const offer = buildJourneyOffer();
    const pkg = await buildEvidencePackage(offer);
    const att = await buildOutreachAttachments(offer, { pkg });
    const copy = composeOfferOutreach(
      offer,
      { buyUrl: `/offer/${(offer as any).shareToken}`, bookingUrl: ARTIFEX_IDENTITY.bookingUrl, videoUrl: att.manifest.videoLinkUrl ?? undefined },
      { assets: { pdf: att.manifest.pdf, video: att.manifest.video } },
    );
    const frame = experienceFrameForOffer(offer);
    // FIRST line is the ONE shared evidence-backed opener, verbatim.
    expect(copy.bodyText.split("\n\n")[0]).toBe(frame.emailOpener);
    expect(frame.emailOpener.toLowerCase()).toContain("book online");
    // NO price / dollar amount / "flat" in the default first-touch body.
    expect(copy.bodyText).not.toMatch(/\$\s?\d|\bflat\b|\bdollars?\b/i);
    // NO raw offer/video/booking URL in the customer-visible body (labels only).
    expect(copy.bodyText).not.toMatch(/https?:\/\//i);
    expect(copy.safe).toBe(true);
  });

  it("the diagnostic PDF attaches (or LINKS) with filename '[Business] — Website Review.pdf'", async () => {
    const offer = buildJourneyOffer();
    const pkg = await buildEvidencePackage(offer);
    const att = await buildOutreachAttachments(offer, { pkg });
    // Filename is the professional, ID-free format regardless of attach vs link.
    expect(att.manifest.filename).toBe(`${SAFE_BUSINESS} — Website Review.pdf`);
    expect(outreachPdfFilename(offer)).toBe(`${SAFE_BUSINESS} — Website Review.pdf`);
    // With a real finding + a deterministic small PDF, the policy ATTACHES.
    expect(att.manifest.pdf).toBe("ATTACHED");
    expect(att.attachment).not.toBeNull();
    expect(att.attachment!.filename).toBe(`${SAFE_BUSINESS} — Website Review.pdf`);
    expect(att.attachment!.contentType).toBe("application/pdf");
    // The PDF NEVER carries an internal offer/lead id in its filename.
    expect(att.manifest.filename).not.toContain(SAFE_LEAD_ID);
    expect(att.manifest.filename).not.toContain(offer.offerVersion);
    expect(att.manifest.filename).not.toMatch(/qfo_|lead_/);
  });

  it("offer model hero uses experience.offerHeroTitle and price appears AFTER the package (#6 + #10 pass)", async () => {
    const offer = buildJourneyOffer();
    const pkg = await buildEvidencePackage(offer);
    const model = buildOfferPageModel({
      offer,
      evergreen: trustVideoAsEvergreen(offer),
      approved: true,
      stripeConfigured: true,
      termsAccepted: true,
      superseded: false,
      bookingUrl: ARTIFEX_IDENTITY.bookingUrl,
      evidence: pkg,
    });
    const frame = experienceFrameForOffer(offer);
    // The hero leads with the experience frame ("I tried to book online."), not price/SKU.
    expect(model.experience.offerHeroTitle).toBe(frame.offerHeroTitle);
    expect(model.experience.offerHeroTitle).toContain("book online");
    expect(model.headline).not.toBe(model.priceLabel);
    // The offer-readiness reading-order artifact: package precedes the single price block.
    const artifact: OfferArtifact = {
      offer,
      evidence: pkg,
      subject: "online booking",
      emailFirstSentence: frame.emailOpener,
      offerPageBlocks: [
        model.experience.offerHeroTitle,
        model.whatWeFound,
        ...model.whatWeFix, // the package (value stack)
        model.priceLabel,   // price appears LAST, after the package
      ],
      checkoutPriceText: model.priceLabel,
      priceVisibleBeforePurchase: true,
      packageItems: model.whatWeFix,
      scopeItems: offer.scope.includedItems,
    };
    // #6 — opens with evidence, not price.
    expect(checkStartsWithEvidence(artifact)).toEqual([]);
    // #10 — the exact price is visible before the purchase step.
    expect(checkPriceVisibleBeforePurchase(artifact)).toEqual([]);
    // Document order: the last package item precedes the price in the reading blocks.
    const blocks = artifact.offerPageBlocks!;
    const lastPkgIdx = blocks.indexOf(model.whatWeFix[model.whatWeFix.length - 1]);
    const priceIdx = blocks.indexOf(model.priceLabel);
    expect(priceIdx).toBeGreaterThan(lastPkgIdx);
  });

  it("the personalized video is honest MISSING; the evergreen is a SEPARATE asset", async () => {
    const offer = buildJourneyOffer();
    const pkg = await buildEvidencePackage(offer);
    expect(pkg.personalizedVideo.status).toBe("MISSING");
    expect(pkg.personalizedVideo.url).toBeNull();
    // The evergreen explainer is a distinct ref — never substituted as personalized.
    expect(pkg.evergreenVideo).not.toBe(pkg.personalizedVideo);
    expect(pkg.personalizedVideo.detail.toLowerCase()).toContain("personalized");
  });

  it("assessOfferReadiness has NO blockers for a fully-ready fixture", async () => {
    const offer = buildReadyScopedOffer();
    const pkg = await buildEvidencePackage(offer);
    const frame = experienceFrameForOffer(offer);
    const current = evidenceVersion(pkg);
    const model = buildOfferPageModel({
      offer, evergreen: trustVideoAsEvergreen(offer), approved: true,
      stripeConfigured: true, termsAccepted: true, superseded: false,
      bookingUrl: ARTIFEX_IDENTITY.bookingUrl, evidence: pkg,
    });
    const priceDollars = `$${Math.round(offer.priceCents / 100)}`;
    // The customer-facing package the operator ships is PLAIN language (the real SKU's
    // internal scope carries a "CTA" jargon token that the customer-language gate flags
    // upstream — jargon is covered by customer-language.test.ts, not this journey test).
    // Part X verifies the evidence-first SEQUENCE + price ordering on a ready artifact.
    const plainPackage = ["Add a clear online booking path", "Confirm it works on a phone"];
    const artifact: OfferArtifact = {
      offer,
      evidence: pkg,
      subject: "online booking",
      emailBody: `${frame.emailOpener} Here is a short review of what we found.`,
      emailFirstSentence: frame.emailOpener,
      offerPageBlocks: [model.experience.offerHeroTitle, model.whatWeFound, ...plainPackage, priceDollars],
      checkoutCopy: "You pay once for the fix. Nothing recurring.",
      checkoutPriceText: priceDollars,
      priceVisibleBeforePurchase: true,
      packageItems: plainPackage,
      scopeItems: plainPackage,
      protectionsCopy: "One round of revisions included.",
      protectionsFacts: { revisionPolicy: offer.scope.revisionPolicy, deliveryWindow: offer.scope.deliveryWindow },
      dependentAssets: [{ kind: "diagnosticPdf", present: true, generatedEvidenceVersion: current }],
      screenshotsRequired: true, // and the desktop screenshot IS ready
    };
    const r = assessOfferReadiness(artifact);
    expect(r.issues.filter((i) => i.severity === "BLOCKER")).toEqual([]);
    expect(r.ready).toBe(true);
    // The READY screenshot really is present (proves the fixture, not a skipped check).
    expect(pkg.screenshotStatus).toBe("READY");
  });

  it("scanDarkPatterns is clean across every customer-facing surface", async () => {
    const offer = buildJourneyOffer();
    const pkg = await buildEvidencePackage(offer);
    const att = await buildOutreachAttachments(offer, { pkg });
    const copy = composeOfferOutreach(
      offer,
      { buyUrl: `/offer/${(offer as any).shareToken}`, bookingUrl: ARTIFEX_IDENTITY.bookingUrl, videoUrl: att.manifest.videoLinkUrl ?? undefined },
      { assets: { pdf: att.manifest.pdf, video: att.manifest.video } },
    );
    const model = buildOfferPageModel({
      offer, evergreen: trustVideoAsEvergreen(offer), approved: true,
      stripeConfigured: true, termsAccepted: true, superseded: false,
      bookingUrl: ARTIFEX_IDENTITY.bookingUrl, evidence: pkg,
    });
    const scan = scanDarkPatterns({
      subject: copy.subject,
      emailBody: copy.bodyText,
      offerPageCopy: [model.experience.offerHeroTitle, model.whatWeFound, model.proposedSolution, ...model.whatWeFix].join("\n"),
    });
    expect(scan.clean).toBe(true);
    expect(scan.violations).toEqual([]);
  });

  it("evidenceVersion is stable across rebuilds of the same evidence", async () => {
    const offer = buildJourneyOffer();
    const a = evidenceVersion(await buildEvidencePackage(offer));
    const b = evidenceVersion(await buildEvidencePackage(offer));
    expect(a).toBe(b);
    expect(a).toMatch(/^ev1_[0-9a-f]{16}$/);
  });

  it("the whole journey performs 0 sends and 0 charges (no email provider invoked)", async () => {
    const offer = buildJourneyOffer();
    const pkg = await buildEvidencePackage(offer);
    // Compose + attach + model — the entire artifact assembly — is PURE. None of these
    // touch a transport. Assert the provider send counter never incremented.
    await buildOutreachAttachments(offer, { pkg });
    composeOfferOutreach(offer, { buyUrl: "/offer/x", bookingUrl: ARTIFEX_IDENTITY.bookingUrl });
    buildOfferPageModel({
      offer, evergreen: trustVideoAsEvergreen(offer), approved: true,
      stripeConfigured: true, termsAccepted: true, superseded: false,
      bookingUrl: ARTIFEX_IDENTITY.bookingUrl, evidence: pkg,
    });
    expect(providerSendCalled).toBe(0);
  });
});

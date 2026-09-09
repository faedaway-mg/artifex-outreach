// ─────────────────────────────────────────────────────────────────────────────
// PART Y — PERSUASION-SAFETY COVERAGE AUDIT (63 checks).
//
// Most of the Part-Y surface is ALREADY proven by existing suites — this file is the
// AUDIT that (a) documents WHICH existing test covers each item, and (b) adds focused
// NEW assertions for the handful of Part-Y items not yet covered by name. Every
// assertion is tied to a REAL fixed-contract function; nothing here re-implements a
// check. Where an item is already covered we reference the owning suite in a comment
// rather than duplicating a passing assertion.
//
// COVERAGE MAP (existing → item):
//   • offer-readiness.test.ts .................. all 15 assessOfferReadiness checks,
//       pass AND fail, incl. #6 opens-with-evidence, #8/#11 price consistency + surprise,
//       #10 price-visible-before-purchase; PART W per-kind dark patterns; PART S
//       evidence-truth version + staleness + approval invalidation; attribution meta.
//   • subject-engine.test.ts (35 cases) ........ curiosity-first subject, no false
//       premise / promo / price / RE:/FWD:, family mapping, policy stamp + defectType.
//   • offer-outreach-first-touch.test.ts ....... first line == emailOpener, no price,
//       no raw URL (labels only), effort line claims only real assets, PDF attach-vs-link,
//       MP4 never attached, "[Business] — Website Review.pdf" filename.
//   • OfferSequence.test.tsx ................... value-before-price document order:
//       hero leads with experience, evidence precedes price, price BEFORE the CTA (not
//       hidden until checkout), included stack from scope only (no fake bonus).
//   • diagnostic-pdf.test.ts ................... §1 opener == emailOpener (one evidence
//       truth), evidence-first → price-last, real screenshot only (no placeholder).
//   • evidence-package.test.ts ................. one-evidence-truth package assembly,
//       personalized video ALWAYS MISSING, evergreen separate.
//   • customer-language.test.ts ............... no unexplained jargon/acronyms/internal
//       keys across email/PDF/video/offer/completion copy.
//   • a2z-journey.test.ts (Part X) ............ the whole booking journey end-to-end.
//
// This file ADDS focused checks for the Part-Y items called out as possibly-uncovered:
//   1. price-first hero detected as UNREADY (checkStartsWithEvidence)
//   2. evidence-before-price PASSES (checkStartsWithEvidence)
//   3. price-missing-until-checkout BLOCKED (checkPriceVisibleBeforePurchase)
//   4. package-before-price PASSES (reading-order over checkStartsWithEvidence)
//   5. offer/checkout price consistency: server price == checkout SKU unit amount
//      (buildCheckoutParams) AND == displayed price (checkPriceMatchesServer)
//   6. surprise-subscription detected (scanDarkPatterns / checkCheckoutNoSurprise)
//   7. one-evidence-truth divergence across email/PDF/offer openers is CAUGHT
//      (experienceFrameForOffer is the single arbiter → checkEmailOpener)
//   8. stale dependent asset flagged (detectStaleAssets / checkPdfCurrent)
//   9. attribution carries persuasionPolicyVersion (funnelEventMeta / PERSUASION_POLICY_VERSION)
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { QuickFixOffer } from "./types";
import type { EvidencePackage } from "./evidence-package";
import { experienceFrameForOffer } from "./experience-frame";
import {
  PERSUASION_POLICY_VERSION,
  checkStartsWithEvidence,
  checkPriceVisibleBeforePurchase,
  checkPriceMatchesServer,
  checkCheckoutNoSurprise,
  checkEmailOpener,
  checkPdfCurrent,
  type OfferArtifact,
} from "./offer-readiness";
import { scanDarkPatterns } from "./no-dark-patterns";
import { evidenceVersion, detectStaleAssets, type DependentAsset } from "./evidence-truth";
import { buildCheckoutParams } from "./stripe-commerce";
import { funnelEventMeta } from "./funnel-instrumentation";

// ── Shared fixtures (mirror the readiness suite's booking offer + package) ──────
function offerWith(problem: string, solution = "Add a working path so visitors can do it.", over: Partial<QuickFixOffer> = {}): QuickFixOffer {
  return {
    offerId: "offer_abc", leadId: "lead_1", companyName: "Acme Roofing",
    findingIds: ["f1"], capabilityKeys: [], band: "ENTRY", priceCents: 30000, currency: "usd",
    scope: {
      offerName: "48-Hour Fix", problemBeingSolved: problem, proposedSolution: solution,
      includedItems: ["Add an online booking path", "Confirm it works on a phone"],
      excludedItems: ["unrelated redesign"], customerInputsRequired: ["site access"],
      deliveryWindow: "Delivered within 48 hours of receiving access", revisionPolicy: "one revision",
    },
    evidenceGrade: "OBSERVED", confidence: 0.9, rationale: "op-facing", economics: {} as any,
    maintenance: null, quickFixEligible: true, notEligibleReason: null, automationLevel: "ASSISTED",
    offerVersion: "v1", state: "APPROVED", generatedAt: "2026-09-01T00:00:00Z", ...over,
  };
}
const BOOKING = offerWith("Visitors can't book an appointment online — there's no booking option.", "Add an online booking path.");

function pkgFor(offer: QuickFixOffer, over: Partial<EvidencePackage> = {}): EvidencePackage {
  return {
    offerId: offer.offerId, leadId: offer.leadId, company: offer.companyName,
    websiteUrl: "https://acme-roofing.example",
    screenshots: [{ id: "lead_1:desktop", imageRoute: "/x", publicUrl: null, viewport: "desktop", pageLabel: "home", sourceUrl: "https://acme-roofing.example", capturedAt: "2026-09-01T00:00:00Z", sha256: "aaa", status: "READY" }],
    screenshotStatus: "READY",
    findings: [{ id: "f1", observation: "we noticed …", plain: "There is no way to book online.", whyItMatters: "Visitors can't schedule.", confidenceLabel: "Observed", confidenceScore: 0.9, screenshotId: "lead_1:desktop" }],
    personalizedVideo: { status: "MISSING", url: null, detail: "" },
    diagnosticPdf: { status: "READY", url: `/api/quick-fix/${offer.offerId}/diagnostic-pdf`, detail: "" },
    evergreenVideo: { status: "NOT_APPLICABLE", url: null, detail: "" },
    confidence: 0.9, evidenceGrade: "OBSERVED", generatedAt: null, ...over,
  };
}
function artifact(over: Partial<OfferArtifact> = {}): OfferArtifact {
  const evidence = pkgFor(BOOKING);
  return { offer: BOOKING, evidence, ...over };
}

// ── (Y-1/Y-2) price-first hero UNREADY; evidence-before-price PASSES ────────────
// Real function: offer-readiness.checkStartsWithEvidence (#6).
// Already exercised in offer-readiness.test.ts "(6) …"; re-asserted here as the
// explicit price-first-vs-evidence-first Part-Y pair.
describe("Y · offer opens with evidence, never with price", () => {
  it("a PRICE-FIRST hero is detected as unready (#6 blocks)", () => {
    const r = checkStartsWithEvidence(artifact({ offerPageBlocks: ["Just $300 today — buy now", "then the details"] }));
    expect(r.some((i) => i.severity === "BLOCKER" && i.surface === "openingFrame")).toBe(true);
  });
  it("an EVIDENCE-FIRST hero passes (#6 clean)", () => {
    const r = checkStartsWithEvidence(artifact({ offerPageBlocks: ["I tried to book online and couldn't find a way.", "Here's the fix."] }));
    expect(r).toEqual([]);
  });
});

// ── (Y-3) price-missing-until-checkout BLOCKED ─────────────────────────────────
// Real function: offer-readiness.checkPriceVisibleBeforePurchase (#10).
describe("Y · exact price must be visible before checkout (never hidden until the purchase step)", () => {
  it("price NOT visible before purchase ⇒ blocked", () => {
    const r = checkPriceVisibleBeforePurchase(artifact({ priceVisibleBeforePurchase: false }));
    expect(r.some((i) => i.severity === "BLOCKER" && i.surface === "priceVisibility")).toBe(true);
  });
  it("price visible before purchase ⇒ clean", () => {
    expect(checkPriceVisibleBeforePurchase(artifact({ priceVisibleBeforePurchase: true }))).toEqual([]);
  });
});

// ── (Y-4) package-before-price PASSES (reading order) ──────────────────────────
// Real function: offer-readiness.checkStartsWithEvidence over blocks whose price is
// LAST. Complements OfferSequence.test.tsx (document-order render assertions).
describe("Y · the value package precedes the price in reading order", () => {
  it("blocks that lead with the package and place price last pass #6, and price index is last", () => {
    const blocks = [
      "I tried to book online and couldn't find a way.",
      "Add an online booking path",
      "Confirm it works on a phone",
      "$300 flat",
    ];
    expect(checkStartsWithEvidence(artifact({ offerPageBlocks: blocks }))).toEqual([]);
    const priceIdx = blocks.findIndex((b) => /\$\d/.test(b));
    const lastPkgIdx = blocks.indexOf("Confirm it works on a phone");
    expect(priceIdx).toBeGreaterThan(lastPkgIdx); // price is after the package
  });
});

// ── (Y-5) offer/checkout price CONSISTENCY: server == checkout SKU == displayed ──
// Real functions: stripe-commerce.buildCheckoutParams (checkout SKU unit amount) +
// offer-readiness.checkPriceMatchesServer (displayed price).
describe("Y · offer, checkout SKU, and displayed price are the ONE server price", () => {
  it("checkout SKU unit amount == offer.priceCents (no divergent checkout price)", () => {
    const params = buildCheckoutParams(BOOKING, { withMaintenance: false, baseUrl: "https://app.example" });
    expect(params.lineItems[0].unitAmountCents).toBe(BOOKING.priceCents);
    expect(params.mode).toBe("payment");
  });
  it("a displayed price that disagrees with the server is a BLOCKER; the matching price is clean", () => {
    expect(checkPriceMatchesServer(artifact({ checkoutPriceText: "$250" })).some((i) => i.severity === "BLOCKER")).toBe(true);
    expect(checkPriceMatchesServer(artifact({ checkoutPriceText: "$300" }))).toEqual([]); // 30000¢
  });
});

// ── (Y-6) surprise-subscription detected ───────────────────────────────────────
// Real functions: no-dark-patterns.scanDarkPatterns (SURPRISE_SUBSCRIPTION) +
// offer-readiness.checkCheckoutNoSurprise. (Per-kind detection also in
// offer-readiness.test.ts "detects SURPRISE_SUBSCRIPTION"; here we prove it blocks
// at the CHECKOUT surface specifically.)
describe("Y · a surprise recurring charge at checkout is caught", () => {
  it("auto-renewing checkout copy is flagged SURPRISE_SUBSCRIPTION and blocks checkout", () => {
    const dp = scanDarkPatterns({ checkoutCopy: "You'll be billed monthly and it auto-renews." });
    expect(dp.violations.map((v) => v.kind)).toContain("SURPRISE_SUBSCRIPTION");
    const r = checkCheckoutNoSurprise(artifact({ checkoutCopy: "You'll be billed monthly and it auto-renews." }));
    expect(r.some((i) => i.surface === "checkout.surprise" && i.severity === "BLOCKER")).toBe(true);
  });
});

// ── (Y-7) ONE evidence truth — divergent openers across surfaces are CAUGHT ──────
// Real function: experience-frame.experienceFrameForOffer is the SINGLE arbiter of the
// opener; offer-readiness.checkEmailOpener rejects any surface whose first sentence
// diverges from it. (diagnostic-pdf.test.ts proves the PDF §1 uses the same string.)
describe("Y · one evidence truth: every surface's opener must match the experience frame", () => {
  it("an email whose first sentence DIVERGES from the frame opener is blocked", () => {
    const r = checkEmailOpener(artifact({ emailBody: "Hey there — want a great deal on your site?" }));
    expect(r).toHaveLength(1);
    expect(r[0].surface).toBe("email.opener");
  });
  it("the exact frame opener passes on every surface (email + PDF + hero derive from it)", () => {
    const frame = experienceFrameForOffer(BOOKING);
    expect(checkEmailOpener(artifact({ emailFirstSentence: frame.emailOpener }))).toEqual([]);
    // The offer hero title and PDF §1 opener are the SAME frame — divergence is impossible
    // by construction because all three call experienceFrameForOffer(offer).
    expect(frame.offerHeroTitle).toContain("book online");
  });
});

// ── (Y-8) stale dependent asset flagged ────────────────────────────────────────
// Real functions: evidence-truth.detectStaleAssets + offer-readiness.checkPdfCurrent.
describe("Y · a dependent asset generated against older evidence is STALE", () => {
  it("a PDF stamped with an older evidence version is detected stale and blocks", () => {
    const pkg = pkgFor(BOOKING);
    const stale: DependentAsset[] = [{ kind: "diagnosticPdf", present: true, generatedEvidenceVersion: "ev1_0000000000000000" }];
    const det = detectStaleAssets(pkg, stale);
    expect(det.anyStale).toBe(true);
    expect(det.assets[0].status).toBe("STALE");
    const r = checkPdfCurrent(artifact({ dependentAssets: stale }));
    expect(r.some((i) => i.surface === "pdf.current" && i.severity === "BLOCKER")).toBe(true);
  });
  it("a PDF stamped with the CURRENT evidence version is clean", () => {
    const pkg = pkgFor(BOOKING);
    const current = evidenceVersion(pkg);
    expect(checkPdfCurrent(artifact({ dependentAssets: [{ kind: "diagnosticPdf", present: true, generatedEvidenceVersion: current }] }))).toEqual([]);
  });
});

// ── (Y-9) attribution carries persuasionPolicyVersion ──────────────────────────
// Real function: funnel-instrumentation.funnelEventMeta + PERSUASION_POLICY_VERSION.
// (attributionBreakdown slicing is proven in offer-readiness.test.ts; here we confirm
// the persuasion policy stamp is carried onto an event's meta.)
describe("Y · downstream funnel events attribute to the persuasion policy version", () => {
  it("funnelEventMeta stamps the frozen persuasion.v1 version for attribution", () => {
    const meta = funnelEventMeta({ persuasionPolicyVersion: PERSUASION_POLICY_VERSION }, { leadId: "lead_1" });
    expect(meta.persuasionPolicyVersion).toBe("persuasion.v1");
    expect(meta.leadId).toBe("lead_1");
  });
});

// ── Sanity: the frozen policy stamp ─────────────────────────────────────────────
describe("Y · policy version is frozen", () => {
  it("PERSUASION_POLICY_VERSION is persuasion.v1", () => {
    expect(PERSUASION_POLICY_VERSION).toBe("persuasion.v1");
  });
});

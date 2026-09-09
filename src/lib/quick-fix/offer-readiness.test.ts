// ─────────────────────────────────────────────────────────────────────────────
// PART U (offer readiness) + PART W (no dark patterns) + PART S (evidence-truth
// staleness) + expanded funnel attribution. These are the reusable persuasion-safety
// primitives Breakbot builds on — so we prove each check independently (pass AND fail),
// the dark-pattern detection per kind, stale-asset detection, and that funnel events
// carry policy/defect attribution.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { QuickFixOffer } from "./types";
import type { EvidencePackage } from "./evidence-package";
import { experienceFrameForOffer } from "./experience-frame";
import {
  PERSUASION_POLICY_VERSION,
  assessOfferReadiness,
  checkSubject,
  checkEmailOpener,
  checkNoRawUrls,
  checkPdfCurrent,
  checkScreenshots,
  checkStartsWithEvidence,
  checkPackageWithinScope,
  checkPriceMatchesServer,
  checkProtectionsAccurate,
  checkPriceVisibleBeforePurchase,
  checkCheckoutNoSurprise,
  checkNoFabricatedClaims,
  checkNoDarkPatterns,
  checkNoJargon,
  checkAttemptedUseHonest,
  type OfferArtifact,
} from "./offer-readiness";
import { scanDarkPatterns } from "./no-dark-patterns";
import {
  evidenceVersion,
  detectStaleAssets,
  approvalInvalidatedByEvidenceChange,
  effectiveAssetStatus,
  type DependentAsset,
} from "./evidence-truth";
import { summarizeFunnel, attributionBreakdown, funnelEventMeta, FUNNEL_EVENTS_EXT } from "./funnel-instrumentation";

// ── Fixtures ─────────────────────────────────────────────────────────────────
function offerWith(problem: string, solution = "Add a working path so visitors can do it.", over: Partial<QuickFixOffer> = {}): QuickFixOffer {
  return {
    offerId: "offer_abc",
    leadId: "lead_1",
    companyName: "Acme Roofing",
    findingIds: ["f1"],
    capabilityKeys: [],
    band: "ENTRY",
    priceCents: 30000,
    currency: "usd",
    scope: {
      offerName: "48-Hour Fix",
      problemBeingSolved: problem,
      proposedSolution: solution,
      includedItems: ["Add an online booking path", "Confirm it works on a phone"],
      excludedItems: ["unrelated redesign"],
      customerInputsRequired: ["site access"],
      deliveryWindow: "Delivered within 48 hours of receiving access",
      revisionPolicy: "one revision",
    },
    evidenceGrade: "OBSERVED",
    confidence: 0.9,
    rationale: "op-facing",
    economics: {} as any,
    maintenance: null,
    quickFixEligible: true,
    notEligibleReason: null,
    automationLevel: "ASSISTED",
    offerVersion: "v1",
    state: "APPROVED",
    generatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const BOOKING = offerWith("Visitors can't book an appointment online — there's no booking option.", "Add an online booking path.");

function pkgFor(offer: QuickFixOffer, over: Partial<EvidencePackage> = {}): EvidencePackage {
  return {
    offerId: offer.offerId,
    leadId: offer.leadId,
    company: offer.companyName,
    websiteUrl: "https://acme-roofing.example",
    screenshots: [
      { id: "lead_1:desktop", imageRoute: "/x", publicUrl: null, viewport: "desktop", pageLabel: "home", sourceUrl: "https://acme-roofing.example", capturedAt: "2026-09-01T00:00:00Z", sha256: "aaa", status: "READY" },
    ],
    screenshotStatus: "READY",
    findings: [
      { id: "f1", observation: "we noticed …", plain: "There is no way to book online.", whyItMatters: "Visitors can't schedule.", confidenceLabel: "Observed", confidenceScore: 0.9, screenshotId: "lead_1:desktop" },
    ],
    personalizedVideo: { status: "MISSING", url: null, detail: "" },
    diagnosticPdf: { status: "READY", url: `/api/quick-fix/${offer.offerId}/diagnostic-pdf`, detail: "" },
    evergreenVideo: { status: "NOT_APPLICABLE", url: null, detail: "" },
    confidence: 0.9,
    evidenceGrade: "OBSERVED",
    generatedAt: null,
    ...over,
  };
}

/** A fully-ready artifact around the BOOKING offer — each test perturbs ONE field. */
function readyArtifact(over: Partial<OfferArtifact> = {}): OfferArtifact {
  const offer = BOOKING;
  const evidence = pkgFor(offer);
  const opener = experienceFrameForOffer(offer).emailOpener;
  const currentVersion = evidenceVersion(evidence);
  return {
    offer,
    evidence,
    subject: "online booking",
    emailBody: `${opener} Here's a quick way to fix it.`,
    offerPageBlocks: [
      "I tried to book online and couldn't find a way to do it from the pages I checked.",
      "Here's what we recommend.",
    ],
    checkoutCopy: "You'll pay once for the fix. Nothing recurring.",
    checkoutPriceText: "$300",
    priceVisibleBeforePurchase: true,
    packageItems: ["Add an online booking path", "Confirm it works on a phone"],
    scopeItems: offer.scope.includedItems,
    protectionsCopy: "One revision included. Delivered within 48 hours of receiving access.",
    protectionsFacts: { revisionPolicy: "one revision", deliveryWindow: "48 hours" },
    dependentAssets: [{ kind: "diagnosticPdf", present: true, generatedEvidenceVersion: currentVersion }],
    screenshotsRequired: true,
    ...over,
  };
}

// ── PERSUASION_POLICY_VERSION ──────────────────────────────────────────────────
describe("persuasion policy version", () => {
  it("is the frozen persuasion.v1 stamp", () => {
    expect(PERSUASION_POLICY_VERSION).toBe("persuasion.v1");
  });
});

// ── The full gate: a clean artifact is READY ───────────────────────────────────
describe("assessOfferReadiness — a clean, evidence-backed artifact is READY", () => {
  it("clean artifact ⇒ ready, no blocker issues", () => {
    const r = assessOfferReadiness(readyArtifact());
    expect(r.issues.filter((i) => i.severity === "BLOCKER")).toEqual([]);
    expect(r.ready).toBe(true);
  });
});

// ── Per-check: pass AND fail ───────────────────────────────────────────────────
describe("readiness checks — each fails on its own defect and passes when correct", () => {
  it("(1) subject: missing ⇒ blocker; evidence-derived+compliant ⇒ clean", () => {
    expect(checkSubject(readyArtifact({ subject: "" })).some((i) => i.severity === "BLOCKER")).toBe(true);
    expect(checkSubject(readyArtifact({ subject: "URGENT!! act now" })).some((i) => i.severity === "BLOCKER")).toBe(true);
    expect(checkSubject(readyArtifact()).some((i) => i.severity === "BLOCKER")).toBe(false);
  });

  it("(2) email opener must equal the evidence-backed experience frame", () => {
    expect(checkEmailOpener(readyArtifact({ emailBody: "Hey there, want a great deal?" }))).toHaveLength(1);
    expect(checkEmailOpener(readyArtifact())).toEqual([]);
  });

  it("(3) no raw URLs in any customer-visible surface", () => {
    expect(checkNoRawUrls(readyArtifact({ offerPageBlocks: ["Visit https://buy.example/x now"] })).length).toBeGreaterThan(0);
    expect(checkNoRawUrls(readyArtifact())).toEqual([]);
  });

  it("(4) attached PDF must be current (not stale) w.r.t. the evidence", () => {
    const stalePdf = readyArtifact({ dependentAssets: [{ kind: "diagnosticPdf", present: true, generatedEvidenceVersion: "ev1_OLDVERSION" }] });
    expect(checkPdfCurrent(stalePdf)).toHaveLength(1);
    // no PDF attached ⇒ nothing to be stale
    expect(checkPdfCurrent(readyArtifact({ dependentAssets: [] }))).toEqual([]);
    expect(checkPdfCurrent(readyArtifact())).toEqual([]);
  });

  it("(5) screenshots required but MISSING ⇒ blocker", () => {
    const noShots = readyArtifact({ evidence: pkgFor(BOOKING, { screenshotStatus: "MISSING", screenshots: [] }) });
    expect(checkScreenshots(noShots)).toHaveLength(1);
    expect(checkScreenshots(readyArtifact())).toEqual([]);
    expect(checkScreenshots(readyArtifact({ screenshotsRequired: false, evidence: pkgFor(BOOKING, { screenshotStatus: "MISSING" }) }))).toEqual([]);
  });

  it("(6) offer must open with evidence/experience, not price", () => {
    expect(checkStartsWithEvidence(readyArtifact({ offerPageBlocks: ["Just $300 today!", "then the details"] }))).toHaveLength(1);
    expect(checkStartsWithEvidence(readyArtifact())).toEqual([]);
  });

  it("(7) package items must be a subset of SKU/scope", () => {
    expect(checkPackageWithinScope(readyArtifact({ packageItems: ["Add an online booking path", "Free SEO forever"] }))).toHaveLength(1);
    expect(checkPackageWithinScope(readyArtifact())).toEqual([]);
  });

  it("(8) displayed price must equal server priceCents", () => {
    expect(checkPriceMatchesServer(readyArtifact({ checkoutPriceText: "$250" }))).toHaveLength(1);
    expect(checkPriceMatchesServer(readyArtifact({ checkoutPriceText: "$300" }))).toEqual([]);
    expect(checkPriceMatchesServer(readyArtifact({ checkoutPriceText: "$300.00" }))).toEqual([]);
  });

  it("(9) protections copy cannot promise a refund/guarantee the policy lacks", () => {
    const badPromise = readyArtifact({ protectionsCopy: "100% money-back guarantee, no questions asked." });
    expect(checkProtectionsAccurate(badPromise)).toHaveLength(1);
    expect(checkProtectionsAccurate(readyArtifact())).toEqual([]);
  });

  it("(10) exact price must be visible before purchase", () => {
    expect(checkPriceVisibleBeforePurchase(readyArtifact({ priceVisibleBeforePurchase: false }))).toHaveLength(1);
    expect(checkPriceVisibleBeforePurchase(readyArtifact())).toEqual([]);
  });

  it("(11) checkout introduces no surprise price/scope/fees", () => {
    expect(checkCheckoutNoSurprise(readyArtifact({ checkoutCopy: "Plus additional fees may apply at checkout." })).length).toBeGreaterThan(0);
    expect(checkCheckoutNoSurprise(readyArtifact({ checkoutPriceText: "$999" })).length).toBeGreaterThan(0);
    expect(checkCheckoutNoSurprise(readyArtifact())).toEqual([]);
  });

  it("(12) no unsupported financial claims (containsFabricatedClaim)", () => {
    expect(checkNoFabricatedClaims(readyArtifact({ emailBody: `${experienceFrameForOffer(BOOKING).emailOpener} This will double your revenue.` })).length).toBeGreaterThan(0);
    expect(checkNoFabricatedClaims(readyArtifact())).toEqual([]);
  });

  it("(13) no fake urgency / dark patterns", () => {
    expect(checkNoDarkPatterns(readyArtifact({ offerPageBlocks: ["Only 2 spots left — act now!"] })).length).toBeGreaterThan(0);
    expect(checkNoDarkPatterns(readyArtifact())).toEqual([]);
  });

  it("(14) no unexplained jargon (assessOfferCustomerLanguage)", () => {
    const jargon = readyArtifact({ offerPageBlocks: ["We'll tune your CTA and fix the viewport."] });
    expect(checkNoJargon(jargon).length).toBeGreaterThan(0);
    expect(checkNoJargon(readyArtifact())).toEqual([]);
  });

  it("(15) attempted-use claims must match experienceFrame.attemptSupported", () => {
    const READABILITY = offerWith("Some of the body text is too small and hard to read on the pages we checked.", "Increase the font size.");
    const frame = experienceFrameForOffer(READABILITY);
    expect(frame.attemptSupported).toBe(false);
    const dishonest = readyArtifact({
      offer: READABILITY,
      evidence: pkgFor(READABILITY),
      emailFirstSentence: frame.emailOpener,
      emailBody: `${frame.emailOpener} I tried to read it and gave up.`,
      offerPageBlocks: ["When I looked at your website, some of the text was hard to read."],
      packageItems: READABILITY.scope.includedItems,
      scopeItems: READABILITY.scope.includedItems,
      dependentAssets: [{ kind: "diagnosticPdf", present: true, generatedEvidenceVersion: evidenceVersion(pkgFor(READABILITY)) }],
    });
    expect(checkAttemptedUseHonest(dishonest)).toHaveLength(1);
    // booking (attemptSupported=true) may say "I tried"
    expect(checkAttemptedUseHonest(readyArtifact())).toEqual([]);
  });

  it("aggregate: a single blocker flips ready=false but is surfaced with surface/expected/observed", () => {
    const r = assessOfferReadiness(readyArtifact({ checkoutPriceText: "$250" }));
    expect(r.ready).toBe(false);
    const priceIssue = r.issues.find((i) => i.surface === "price.match");
    expect(priceIssue).toBeTruthy();
    expect(priceIssue!.expected).toMatch(/30000/);
    expect(priceIssue!.observed).toMatch(/25000/);
  });
});

// ── PART W: no dark patterns ───────────────────────────────────────────────────
describe("no-dark-patterns — deterministic detection per kind", () => {
  it("clean copy ⇒ clean, no violations", () => {
    const r = scanDarkPatterns({ subject: "online booking", emailBody: "Here's what I found on your site.", offerPageCopy: "We recommend a clear booking path." });
    expect(r.clean).toBe(true);
    expect(r.violations).toEqual([]);
  });

  const cases: Array<[string, any, string]> = [
    ["FAKE_COUNTDOWN", { offerPageCopy: "Offer expires in 5 minutes" }, "FAKE_COUNTDOWN"],
    ["FAKE_SCARCITY", { offerPageCopy: "Only 3 spots left" }, "FAKE_SCARCITY"],
    ["FALSE_URGENCY", { subject: "act now" }, "FALSE_URGENCY"],
    ["FAKE_SAVINGS", { offerPageCopy: "was $600 now $300" }, "FAKE_SAVINGS"],
    ["HIDDEN_FEES", { checkoutCopy: "additional fees may apply" }, "HIDDEN_FEES"],
    ["SURPRISE_SUBSCRIPTION", { checkoutCopy: "auto-renews every month" }, "SURPRISE_SUBSCRIPTION"],
    ["PRECHECKED_EXTRA", { checkoutCopy: "pre-selected maintenance add-on" }, "PRECHECKED_EXTRA"],
    ["MISLEADING_CTA", { offerPageCopy: "No, I don't want more customers" }, "MISLEADING_CTA"],
    ["DECEPTIVE_SUBJECT", { subject: "your payment failed" }, "DECEPTIVE_SUBJECT"],
    ["FALSE_INQUIRY", { subject: "new customer inquiry" }, "FALSE_INQUIRY"],
    ["FALSE_THREAD", { subject: "re: our chat" }, "FALSE_THREAD"],
    ["EXAGGERATED_CLAIM", { emailBody: "This will get you 40% more traffic." }, "EXAGGERATED_CLAIM"],
  ];
  for (const [name, surfaces, kind] of cases) {
    it(`detects ${name}`, () => {
      const r = scanDarkPatterns(surfaces);
      expect(r.clean).toBe(false);
      expect(r.violations.map((v) => v.kind)).toContain(kind);
      // every violation names its surface + a matched fragment
      for (const v of r.violations) {
        expect(v.surface.length).toBeGreaterThan(0);
        expect(v.match.length).toBeGreaterThan(0);
      }
    });
  }
});

// ── PART S: evidence-truth staleness ───────────────────────────────────────────
describe("evidence-truth — canonical version + staleness", () => {
  it("evidenceVersion is deterministic and stable across rebuilds of the same evidence", () => {
    const a = evidenceVersion(pkgFor(BOOKING));
    const b = evidenceVersion(pkgFor(BOOKING));
    expect(a).toBe(b);
    expect(a).toMatch(/^ev1_[0-9a-f]{16}$/);
  });

  it("a material change to a finding bumps the version", () => {
    const base = evidenceVersion(pkgFor(BOOKING));
    const changed = evidenceVersion(pkgFor(BOOKING, {
      findings: [{ id: "f1", observation: "x", plain: "Booking is now completely broken.", whyItMatters: "w", confidenceLabel: "Observed", confidenceScore: 0.9, screenshotId: null }],
    }));
    expect(changed).not.toBe(base);
  });

  it("a recaptured screenshot (new sha256) bumps the version", () => {
    const base = evidenceVersion(pkgFor(BOOKING));
    const recaptured = evidenceVersion(pkgFor(BOOKING, {
      screenshots: [{ id: "lead_1:desktop", imageRoute: "/x", publicUrl: null, viewport: "desktop", pageLabel: "home", sourceUrl: "https://acme-roofing.example", capturedAt: "2026-09-02T00:00:00Z", sha256: "DIFFERENT", status: "READY" }],
    }));
    expect(recaptured).not.toBe(base);
  });

  it("volatile fields (imageRoute/detail/generatedAt) do NOT bump the version", () => {
    const base = evidenceVersion(pkgFor(BOOKING));
    const cosmetically = evidenceVersion(pkgFor(BOOKING, { generatedAt: "2030-01-01T00:00:00Z", diagnosticPdf: { status: "READY", url: "/other", detail: "changed detail" } }));
    expect(cosmetically).toBe(base);
  });

  it("detectStaleAssets: OK when stamped-current, STALE when older, UNSTAMPED when absent, NOT_PRESENT when no artifact", () => {
    const pkg = pkgFor(BOOKING);
    const current = evidenceVersion(pkg);
    const assets: DependentAsset[] = [
      { kind: "diagnosticPdf", present: true, generatedEvidenceVersion: current },
      { kind: "personalizedVideo", present: true, generatedEvidenceVersion: "ev1_stale00000000" },
      { kind: "screenshotDerivative", present: true, generatedEvidenceVersion: null },
      { kind: "diagnosticPdf", present: false, generatedEvidenceVersion: null },
    ];
    const det = detectStaleAssets(pkg, assets);
    expect(det.currentVersion).toBe(current);
    expect(det.assets.map((a) => a.status)).toEqual(["OK", "STALE", "UNSTAMPED", "NOT_PRESENT"]);
    expect(det.anyStale).toBe(true);
    // only present-and-mismatched/unstamped are stale
    expect(det.assets.filter((a) => a.stale).map((a) => a.status)).toEqual(["STALE", "UNSTAMPED"]);
  });

  it("approvalInvalidatedByEvidenceChange invalidates on change and on missing stamp; holds when unchanged", () => {
    const pkg = pkgFor(BOOKING);
    const current = evidenceVersion(pkg);
    expect(approvalInvalidatedByEvidenceChange(pkg, current).invalidate).toBe(false);
    expect(approvalInvalidatedByEvidenceChange(pkg, "ev1_old0000000000").invalidate).toBe(true);
    expect(approvalInvalidatedByEvidenceChange(pkg, null).invalidate).toBe(true);
  });

  it("effectiveAssetStatus downgrades a READY-but-stale/unstamped asset", () => {
    const pkg = pkgFor(BOOKING);
    const current = evidenceVersion(pkg);
    expect(effectiveAssetStatus("READY", current, current)).toBe("READY");
    expect(effectiveAssetStatus("READY", "ev1_old0000000000", current)).toBe("STALE");
    expect(effectiveAssetStatus("READY", null, current)).toBe("UNVERIFIED");
    expect(effectiveAssetStatus("MISSING", null, current)).toBe("MISSING");
  });
});

// ── Expanded funnel + attribution ──────────────────────────────────────────────
describe("funnel instrumentation — expanded vocabulary + attribution", () => {
  it("summarizeFunnel counts the new expanded events and sums legacy+expanded per stage", () => {
    const events = [
      { action: FUNNEL_EVENTS_EXT.evidenceViewed, targetType: "quickfix_offer", targetId: "o1" },
      { action: "quickfix.pdf_viewed", targetType: "quickfix_offer", targetId: "o1" }, // legacy evidence event
      { action: FUNNEL_EVENTS_EXT.livePageVerifyClicked, targetType: "quickfix_offer", targetId: "o1" },
      { action: FUNNEL_EVENTS_EXT.personalizedVideoStarted, targetType: "quickfix_offer", targetId: "o1" },
      { action: FUNNEL_EVENTS_EXT.purchaseVerified, targetType: "quickfix_offer", targetId: "o1" },
    ];
    const s = summarizeFunnel(events);
    expect(s.hasTracking).toBe(true);
    const evidence = s.stages.find((x) => x.key === "evidence_viewed")!;
    expect(evidence.count).toBe(2); // expanded + legacy summed
    expect(s.stages.find((x) => x.key === "live_page_verified")!.count).toBe(1);
    expect(s.stages.find((x) => x.key === "personalized_video_started")!.count).toBe(1);
    expect(s.purchases).toBe(1);
  });

  it("empty log ⇒ hasTracking=false (never fabricated)", () => {
    expect(summarizeFunnel([]).hasTracking).toBe(false);
  });

  it("funnelEventMeta stamps persuasion + subject policy versions + defectType for attribution", () => {
    const meta = funnelEventMeta(
      { persuasionPolicyVersion: PERSUASION_POLICY_VERSION, subjectPolicyVersion: "subject.v1", defectType: "booking" },
      { leadId: "lead_1" },
    );
    expect(meta).toMatchObject({
      leadId: "lead_1",
      persuasionPolicyVersion: "persuasion.v1",
      subjectPolicyVersion: "subject.v1",
      defectType: "booking",
    });
    // absent attribution is simply not present (never fabricated)
    expect(funnelEventMeta({}, null)).toEqual({});
  });

  it("attributionBreakdown slices events by policy version and defect type", () => {
    const events = [
      { action: FUNNEL_EVENTS_EXT.evidenceViewed, meta: { persuasionPolicyVersion: "persuasion.v1", defectType: "booking" } },
      { action: FUNNEL_EVENTS_EXT.checkoutStarted, meta: { persuasionPolicyVersion: "persuasion.v1", subjectPolicyVersion: "subject.v1", defectType: "contact" } },
      { action: "quickfix.offer_page_viewed", meta: null },
      { action: "unrelated.event", meta: { persuasionPolicyVersion: "persuasion.v1" } }, // non-quickfix ignored
    ];
    const b = attributionBreakdown(events);
    expect(b.persuasionPolicyVersion).toEqual([{ key: "persuasionPolicyVersion", value: "persuasion.v1", count: 2 }]);
    expect(b.subjectPolicyVersion).toEqual([{ key: "subjectPolicyVersion", value: "subject.v1", count: 1 }]);
    expect(b.defectType.map((r) => r.value).sort()).toEqual(["booking", "contact"]);
  });
});

// ── qualification wiring — readiness separate from sales qualification ──────────
import { qualifyLead, type QualificationInput } from "./qualification";
import { assessContactability } from "./contactability";
import { assessCommercialFit } from "./commercial-fit";
import { assessCompetitiveOverlap } from "./competitive-overlap";
import { sendEligibility } from "./jurisdiction";

function qBase(over: Partial<QualificationInput> = {}): QualificationInput {
  return {
    hasWebsite: true,
    contactability: assessContactability({ email: "hello@acmedental.com", website: "https://acmedental.com" }),
    suppressed: false,
    businessActive: true,
    commercialFit: assessCommercialFit({ hasActiveWebsite: true, hasCommercialIntent: true, reviewCount: 120, locationsCount: 2, establishedDomain: true, defectAffectsCommercialAction: true, priceCents: 24900, effectiveHourlyCents: 20000, strongSkuSupport: true }),
    overlap: assessCompetitiveOverlap({ industry: "Dental practice" }),
    readyToSellFix: true,
    matchedSku: "cta-repair",
    confidence: 0.92,
    hasObservedDefect: true,
    clearsMarginGate: true,
    jurisdiction: sendEligibility("US"),
    ...over,
  };
}

describe("qualification wiring — offer readiness is DISTINCT from sales qualification", () => {
  it("an unready offer is NOT readyToSend but IS still sales-qualified (readyToSell)", () => {
    const q = qualifyLead(qBase({ offerReady: false, offerReadinessBlockers: ["stale PDF", "raw URL"] }));
    expect(q.readyToSell).toBe(true);          // sales qualification untouched
    expect(q.readyToSend).toBe(false);         // send gate blocked by readiness
    expect(q.offerReady).toBe(false);
    expect(q.reasons.join(" ")).toMatch(/not ready to send/i);
  });

  it("a ready offer is both sales-qualified and readyToSend", () => {
    const q = qualifyLead(qBase({ offerReady: true }));
    expect(q.readyToSell).toBe(true);
    expect(q.readyToSend).toBe(true);
  });

  it("readiness not evaluated (undefined) ⇒ readyToSend tracks sales qualification", () => {
    const q = qualifyLead(qBase());
    expect(q.readyToSell).toBe(true);
    expect(q.readyToSend).toBe(true);
    expect(q.offerReady).toBeUndefined();
  });

  it("a sales disqualifier keeps both false regardless of readiness", () => {
    const q = qualifyLead(qBase({ hasWebsite: false, offerReady: true }));
    expect(q.readyToSell).toBe(false);
    expect(q.readyToSend).toBe(false);
  });
});

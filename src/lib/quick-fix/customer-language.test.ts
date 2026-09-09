// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER-LANGUAGE (no-jargon) GATE — proves that customer-facing copy an owner
// reads must be plain: no unexplained acronym (CTA/CMS/WCAG/GA4/GTM…), no internal
// SKU key (cta-repair), no developer/marketing jargon, no vague non-action. Operators
// keep technical terms internally; only CUSTOMER-facing surfaces are gated; and a
// plain-language translation must NOT change factual scope. Wired into readyToSell.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  assessCustomerLanguage,
  assessOfferCustomerLanguage,
  CUSTOMER_ALLOWLIST,
  GATED_ACRONYMS,
} from "./customer-language";
import { qualifyLead, type QualificationInput } from "./qualification";
import { assessContactability } from "./contactability";
import { assessCommercialFit } from "./commercial-fit";
import { assessCompetitiveOverlap } from "./competitive-overlap";
import { sendEligibility } from "./jurisdiction";
import type { QuickFixOffer, OfferScope } from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const STRONG_FIT = assessCommercialFit({ hasActiveWebsite: true, hasCommercialIntent: true, reviewCount: 120, locationsCount: 2, establishedDomain: true, defectAffectsCommercialAction: true, priceCents: 24900, effectiveHourlyCents: 20000, strongSkuSupport: true });

function qualInput(over: Partial<QualificationInput> = {}): QualificationInput {
  return {
    hasWebsite: true,
    contactability: assessContactability({ email: "hello@acmedental.com", website: "https://acmedental.com" }),
    suppressed: false,
    businessActive: true,
    commercialFit: STRONG_FIT,
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

// A clean, plain-language scope a normal owner reads without a translator.
function cleanScope(over: Partial<OfferScope> = {}): OfferScope {
  return {
    offerName: "Booking & Contact Button Repair",
    problemBeingSolved: "Your main contact button is hard to find on a phone.",
    proposedSolution: "We move your contact button so visitors can tap it right away.",
    includedItems: ["Move the contact button to the top", "Fix the broken link", "Check it on phone and computer"],
    excludedItems: ["Full website redesign", "New logo or brand"],
    customerInputsRequired: ["Editor access to your website"],
    deliveryWindow: "Delivered within 48 hours of receiving access",
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
    ...over,
  };
}

function offerWithScope(scope: OfferScope, over: Partial<QuickFixOffer> = {}): QuickFixOffer {
  return {
    offerId: "off_1", leadId: "lead_1", companyName: "Acme Dental",
    findingIds: ["f1"], capabilityKeys: ["cta-repair"],
    band: "ENTRY", priceCents: 24900, currency: "usd",
    scope,
    evidenceGrade: "OBSERVED", confidence: 0.92,
    rationale: "Operator-facing: strong CTA-repair SKU match, GA4 tracking gap noted.", // internal jargon OK
    economics: {
      priceCents: 24900, estimatedHours: 2, externalCostCents: 0, grossContributionCents: 24900,
      effectiveHourlyCents: 12450, deliveryRisk: "low", supportBurden: "low",
      clearsMarginGate: true, marginReasons: [],
    },
    maintenance: null,
    quickFixEligible: true, notEligibleReason: null,
    automationLevel: "ASSISTED", offerVersion: "v1", state: "DRAFT", generatedAt: null,
    ...over,
  };
}

// ── 1) "CTA" cannot appear unexplained in customer-facing primary copy ─────────
describe("customer-language gate — unexplained acronyms", () => {
  it("1. a bare 'CTA' in customer primary copy fails; expanding it passes", () => {
    const bad = assessCustomerLanguage("We will fix your CTA so more visitors act.");
    expect(bad.passes).toBe(false);
    expect(bad.problems.join(" ")).toMatch(/CTA/);

    // Expanded on first use → passes.
    const good = assessCustomerLanguage("We will fix your call-to-action button so more visitors act.");
    expect(good.passes).toBe(true);

    // Parenthetical gloss adjacent to the acronym also counts as explained.
    const glossed = assessCustomerLanguage("We fix your CTA (the button visitors click to contact you).");
    expect(glossed.passes).toBe(true);

    // A bare "(CTA)" with no spelled-out phrase is NOT an explanation.
    const bareParen = assessCustomerLanguage("We fix your (CTA) so visitors act.");
    expect(bareParen.passes).toBe(false);
  });

  // ── 4) WCAG not exposed unexplained ──
  it("4. WCAG unexplained fails; with an accessibility explanation it passes", () => {
    expect(assessCustomerLanguage("We bring your site up to WCAG.").passes).toBe(false);
    expect(assessCustomerLanguage("We improve accessibility so your site meets the Web Content Accessibility Guidelines (WCAG).").passes).toBe(true);
  });

  // ── 5) GA4 / GTM expanded or translated ──
  it("5. GA4 and GTM must be expanded or translated", () => {
    expect(assessCustomerLanguage("We set up GA4 and GTM for you.").passes).toBe(false);
    // Translated to plain language (no acronym at all).
    expect(assessCustomerLanguage("We set up visitor tracking with Google Analytics for you.").passes).toBe(true);
    // Expanded acronym.
    expect(assessCustomerLanguage("We set up Google Tag Manager (GTM) to track visitors.").passes).toBe(true);
  });

  it("every gated acronym is flagged when bare and none is on the allowlist", () => {
    for (const a of GATED_ACRONYMS) {
      expect(CUSTOMER_ALLOWLIST.includes(a)).toBe(false);
      expect(assessCustomerLanguage(`Your ${a} needs work.`).passes).toBe(false);
    }
    // Genuinely-common terms on the allowlist never fail.
    expect(assessCustomerLanguage("We email you a PDF at this URL when the FAQ is ready.").passes).toBe(true);
  });
});

// ── 3) CMS gets a plain explanation if shown ──
describe("customer-language gate — CMS / internal keys / jargon", () => {
  it("3. CMS shown to a customer needs a plain explanation", () => {
    expect(assessCustomerLanguage("We update your CMS.").passes).toBe(false);
    expect(assessCustomerLanguage("We update your website platform (content management system).").passes).toBe(true);
  });

  // ── 2) internal cta-repair may remain internal while customer sees plain language ──
  it("2. the internal 'cta-repair' key is fine internally but fails in customer text", () => {
    // Customer text containing the raw SKU key fails.
    expect(assessCustomerLanguage("Your cta-repair order is confirmed.").passes).toBe(false);
    // The plain customer title passes.
    expect(assessCustomerLanguage("Your Booking & Contact Button Repair order is confirmed.").passes).toBe(true);
    // Everyday hyphenated words are NOT treated as internal keys.
    expect(assessCustomerLanguage("This is a one-time, mobile-friendly fix with follow-up.").passes).toBe(true);
  });

  it("developer/marketing jargon (viewport, metadata, funnel) fails in customer copy", () => {
    expect(assessCustomerLanguage("We adjust the viewport and metadata.").passes).toBe(false);
    expect(assessCustomerLanguage("We optimize your conversion funnel to leverage synergy.").passes).toBe(false);
    expect(assessCustomerLanguage("We make your site read clearly on a phone.").passes).toBe(true);
  });

  it("vague phrases that don't describe a real customer action fail", () => {
    expect(assessCustomerLanguage("Let's circle back and touch base to unlock value.").passes).toBe(false);
    expect(assessCustomerLanguage("Reply YES and we send you the checkout link.").passes).toBe(true);
  });
});

// ── 6) technical terms still allowed to operators ──
describe("customer-language gate — operators keep technical terms", () => {
  it("6. operator-facing fields (rationale, economics) are NOT scanned", () => {
    // The offer's rationale is packed with CTA / GA4 / SKU jargon but is operator-facing.
    const offer = offerWithScope(cleanScope(), {
      rationale: "Strong cta-repair SKU; GA4/GTM gap; high CRO upside; WCAG contrast fail on hero CTA.",
    });
    const res = assessOfferCustomerLanguage(offer);
    expect(res.passes).toBe(true); // rationale/economics/capability.name never inspected
  });

  it("qualifyLead: operators keeping jargon internally does not block readyToSell", () => {
    // customerLanguageClean===true (offer copy is clean) → funnel can pass.
    const q = qualifyLead(qualInput({ customerLanguageClean: true }));
    expect(q.readyToSell).toBe(true);
    // customerLanguageClean undefined (not applicable) also does not block.
    const q2 = qualifyLead(qualInput({ customerLanguageClean: undefined }));
    expect(q2.readyToSell).toBe(true);
  });
});

// ── wiring: an offer cannot become readyToSell if customer copy fails ──
describe("customer-language gate — wired into readyToSell", () => {
  it("customerLanguageClean===false blocks readyToSell with a CUSTOMER_LANGUAGE disqualifier", () => {
    const q = qualifyLead(qualInput({ customerLanguageClean: false, customerLanguageProblems: ['unexplained acronym "CTA"'] }));
    expect(q.readyToSell).toBe(false);
    expect(q.disqualifiers).toContain("CUSTOMER_LANGUAGE");
    expect(q.reasons.join(" ")).toMatch(/plain-language gate/);
  });

  it("a full offer with a bare CTA in customer scope fails the offer scan", () => {
    const offer = offerWithScope(cleanScope({ proposedSolution: "We repair your CTA and CMS." }));
    const res = assessOfferCustomerLanguage(offer);
    expect(res.passes).toBe(false);
    expect(res.problems.some((p) => p.includes("proposedSolution"))).toBe(true);
    expect(res.problems.join(" ")).toMatch(/CTA/);
    expect(res.problems.join(" ")).toMatch(/CMS/);
  });

  it("a fully plain offer scope passes the offer scan", () => {
    const res = assessOfferCustomerLanguage(offerWithScope(cleanScope()));
    expect(res.passes).toBe(true);
  });
});

// ── 7) translation cannot change scope ──
describe("customer-language gate — translation preserves factual scope", () => {
  it("7. the gate only REPORTS; it never rewrites copy or alters scope", () => {
    const scope = cleanScope({ proposedSolution: "We fix your CTA." });
    const offer = offerWithScope(scope);
    const before = JSON.stringify(offer.scope);
    assessOfferCustomerLanguage(offer);
    // The gate is read-only: scope object is byte-for-byte unchanged.
    expect(JSON.stringify(offer.scope)).toBe(before);
  });

  it("7b. an operator's plain-language rewrite keeps the same included/excluded scope", () => {
    // Jargon version and plain version differ ONLY in wording, not in scope facts.
    const jargon = cleanScope({
      proposedSolution: "We reposition the primary CTA above the fold.",
      includedItems: ["Reposition the CTA above the fold", "Fix the broken link"],
    });
    const plain = cleanScope({
      proposedSolution: "We move your main contact button to the top of the page.",
      includedItems: ["Move the contact button to the top", "Fix the broken link"],
    });
    // Same number of included/excluded items and same excluded set = scope unchanged.
    expect(plain.includedItems.length).toBe(jargon.includedItems.length);
    expect(plain.excludedItems).toEqual(jargon.excludedItems);
    // Jargon version fails, plain version passes — translation is what makes it sendable.
    expect(assessOfferCustomerLanguage(offerWithScope(jargon)).passes).toBe(false);
    expect(assessOfferCustomerLanguage(offerWithScope(plain)).passes).toBe(true);
  });
});

// ── 8/9/10) derived customer surfaces: narration, PDF, completion report ──
describe("customer-language gate — covers derived customer surfaces", () => {
  it("8. covers video narration text", () => {
    const offer = offerWithScope(cleanScope());
    const bad = assessOfferCustomerLanguage(offer, { videoNarration: "In this video we walk through your CTA and SEO." });
    expect(bad.passes).toBe(false);
    expect(bad.problems.some((p) => p.startsWith("[videoNarration]"))).toBe(true);

    const good = assessOfferCustomerLanguage(offer, { videoNarration: "In this video we walk through your main contact button." });
    expect(good.passes).toBe(true);
  });

  it("9. covers PDF text", () => {
    const offer = offerWithScope(cleanScope());
    const bad = assessOfferCustomerLanguage(offer, { pdfText: "This report reviews your site's UX and WCAG compliance." });
    expect(bad.passes).toBe(false);
    expect(bad.problems.some((p) => p.startsWith("[pdfText]"))).toBe(true);
  });

  it("10. covers the completion report", () => {
    const offer = offerWithScope(cleanScope());
    const bad = assessOfferCustomerLanguage(offer, { completionReport: "We shipped the cta-repair and refreshed your DNS." });
    expect(bad.passes).toBe(false);
    expect(bad.problems.some((p) => p.startsWith("[completionReport]"))).toBe(true);

    const good = assessOfferCustomerLanguage(offer, {
      completionReport: "We finished your Booking & Contact Button Repair and updated your domain settings.",
    });
    expect(good.passes).toBe(true);
  });
});

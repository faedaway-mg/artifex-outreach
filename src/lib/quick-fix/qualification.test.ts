// ─────────────────────────────────────────────────────────────────────────────
// STRICT QUALIFICATION — contactability, commercial fit, competitive overlap,
// jurisdiction, and the full funnel. A business becomes sendable only when it
// passes every gate; a shortage never lowers the bar (that's a discovery problem).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { assessContactability } from "./contactability";
import { assessCommercialFit } from "./commercial-fit";
import { assessCompetitiveOverlap } from "./competitive-overlap";
import { sendEligibility, inferCountry, jurisdictionRegistrySnapshot } from "./jurisdiction";
import { qualifyLead, type QualificationInput } from "./qualification";

const STRONG_FIT = assessCommercialFit({ hasActiveWebsite: true, hasCommercialIntent: true, reviewCount: 120, locationsCount: 2, establishedDomain: true, defectAffectsCommercialAction: true, priceCents: 24900, effectiveHourlyCents: 20000, strongSkuSupport: true });
const NO_OVERLAP = assessCompetitiveOverlap({ industry: "Dental practice" });
const US = sendEligibility("US");

// A fully-passing base input; each test perturbs ONE gate.
function base(over: Partial<QualificationInput> = {}): QualificationInput {
  return {
    hasWebsite: true,
    contactability: assessContactability({ email: "hello@acmedental.com", website: "https://acmedental.com" }),
    suppressed: false,
    businessActive: true,
    commercialFit: STRONG_FIT,
    overlap: NO_OVERLAP,
    readyToSellFix: true,
    matchedSku: "cta-repair",
    confidence: 0.92,
    hasObservedDefect: true,
    clearsMarginGate: true,
    jurisdiction: US,
    ...over,
  };
}

describe("contactability — honest grading, no fabricated verification", () => {
  it("25. an address on the business's own domain is high-confidence with official provenance", () => {
    const c = assessContactability({ email: "info@acmeroofing.com", website: "https://acmeroofing.com" });
    expect(c.state).toBe("HIGH_CONFIDENCE_EMAIL");
    expect(c.provenance).toBe("official-website");
    expect(c.emailableAuto).toBe(true);
  });
  it("a published free-provider address is NOT auto-rejected for its domain", () => {
    const c = assessContactability({ email: "acmeroofing@gmail.com", website: "https://acmeroofing.com", provenance: "published-contact-page" });
    expect(c.state).toBe("HIGH_CONFIDENCE_EMAIL");
    expect(c.emailableAuto).toBe(true);
    expect(c.reasons.join(" ")).toMatch(/provenance, not domain/);
  });
  it("24. an unverified / catch-all address is never silently treated as verified", () => {
    const unver = assessContactability({ email: "random@somebiz.io" });
    expect(unver.state).toBe("UNVERIFIED_EMAIL");
    expect(unver.emailableAuto).toBe(false);
    expect(unver.emailableWithApproval).toBe(true);
    const cat = assessContactability({ email: "x@catchall.io", catchAll: true });
    expect(cat.state).toBe("CATCH_ALL");
    expect(cat.emailableAuto).toBe(false);
  });
  it("a prior bounce makes an address unsendable even if otherwise good", () => {
    const c = assessContactability({ email: "hi@acme.com", website: "https://acme.com", bounced: true });
    expect(c.emailableAuto).toBe(false);
    expect(c.emailableWithApproval).toBe(false);
  });
  it("no email → NO_EMAIL, never sendable", () => {
    expect(assessContactability({ email: null }).state).toBe("NO_EMAIL");
    expect(assessContactability({ email: "not-an-email" }).hasEmail).toBe(false);
  });
});

describe("commercial fit — observable proxies only, never affordability", () => {
  it("26. score is built from observable signals; undefined signals add nothing", () => {
    const empty = assessCommercialFit({});
    expect(empty.score).toBe(0);
    expect(empty.makesCommercialSense).toBe(false);
    expect(STRONG_FIT.score).toBeGreaterThanOrEqual(65);
    expect(STRONG_FIT.band).toBe("STRONG");
  });
  it("27. exposes no revenue/affordability field — only fit signals and a sense verdict", () => {
    const keys = Object.keys(STRONG_FIT);
    expect(keys).not.toContain("revenue");
    expect(keys).not.toContain("estimatedRevenue");
    expect(keys).not.toContain("canAfford");
    expect(keys).not.toContain("bankBalance");
    // Every contribution is tied to an observable note.
    for (const c of STRONG_FIT.contributions) expect(c.note.length).toBeGreaterThan(0);
  });
});

describe("competitive overlap — evidence-based, no single-keyword false positives", () => {
  it("28. an obvious web agency is STRONG overlap and disqualifies a basic repair pitch", () => {
    const o = assessCompetitiveOverlap({ industry: "Web Design & Development Agency", description: "we build websites and custom software" });
    expect(o.verdict).toBe("STRONG");
    expect(o.disqualifies).toBe(true);
  });
  it("29. a normal SMB with a single generic word is NOT overlap", () => {
    const o = assessCompetitiveOverlap({ industry: "Bakery", description: "fresh bread and a simple website for orders" });
    expect(o.verdict).toBe("NONE");
    expect(o.disqualifies).toBe(false);
  });
});

describe("jurisdiction — fail closed, no inherited rules", () => {
  it("37. an UNKNOWN jurisdiction fails closed", () => {
    const v = sendEligibility("ZZ");
    expect(v.state).toBe("UNKNOWN");
    expect(v.coldSendAllowed).toBe(false);
    expect(inferCountry({ state: "XX" })).toBe("UNKNOWN");
  });
  it("38. a country does not inherit another country's rule (UK/CA/IE are not sendable, US is)", () => {
    expect(sendEligibility("US").coldSendAllowed).toBe(true);
    for (const c of ["GB", "CA", "IE", "AU", "NZ"]) expect(sendEligibility(c).coldSendAllowed).toBe(false);
  });
  it("39. an entity-type-required jurisdiction with unknown entity is not sendable", () => {
    const v = sendEligibility("GB", "unknown");
    expect(v.coldSendAllowed).toBe(false);
  });
  it("40. only jurisdictions with a sourced, operator-approved rule are enabled (currently only the US)", () => {
    const snap = jurisdictionRegistrySnapshot();
    expect(snap.enabled).toEqual(["United States"]);
    expect(snap.review.length).toBeGreaterThan(0);
  });
});

describe("strict funnel — every gate must pass; shortage never lowers the bar", () => {
  it("21. no email → not READY_TO_SELL", () => {
    const q = qualifyLead(base({ contactability: assessContactability({ email: null }) }));
    expect(q.readyToSell).toBe(false);
    expect(q.disqualifiers).toContain("NO_EMAIL");
  });
  it("22. no website → not READY_TO_SELL", () => {
    const q = qualifyLead(base({ hasWebsite: false }));
    expect(q.readyToSell).toBe(false);
    expect(q.disqualifiers).toContain("NO_WEBSITE");
  });
  it("23. suppressed → not READY_TO_SELL", () => {
    const q = qualifyLead(base({ suppressed: true }));
    expect(q.readyToSell).toBe(false);
    expect(q.disqualifiers).toContain("SUPPRESSED");
  });
  it("a fully-passing US lead with an own-domain address IS ready to sell", () => {
    const q = qualifyLead(base());
    expect(q.readyToSell).toBe(true);
    expect(q.stageReached).toBe("HIGH_CONFIDENCE_READY_TO_SELL");
    expect(q.disqualifiers).toHaveLength(0);
  });
  it("an unverified address blocks AUTO ready-to-sell (needs operator approval), not deleted", () => {
    const q = qualifyLead(base({ contactability: assessContactability({ email: "x@unknownbiz.io" }) }));
    expect(q.readyToSell).toBe(false);
    expect(q.emailable).toBe(true);
    expect(q.disqualifiers).toContain("EMAIL_UNVERIFIED");
  });
  it("weak evidence / thin margin / overlap each independently block ready-to-sell", () => {
    expect(qualifyLead(base({ confidence: 0.4 })).disqualifiers).toContain("WEAK_EVIDENCE");
    expect(qualifyLead(base({ clearsMarginGate: false })).disqualifiers).toContain("THIN_MARGIN");
    expect(qualifyLead(base({ overlap: assessCompetitiveOverlap({ industry: "software development agency" }) })).disqualifiers).toContain("COMPETITIVE_OVERLAP");
  });
});

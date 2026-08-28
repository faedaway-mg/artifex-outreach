// ─────────────────────────────────────────────────────────────────────────────
// Evidence-first Quick Review invariants. A finding cannot reach the client-facing review unless we
// can point to public evidence for it: directly observed / third-party reported, non-empty basis,
// publicly-observable, non-speculative. Speculative internal-operations guesses are dropped by
// construction. Includes the Urban Americana regression case (no company-specific hard-coding).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { selectReviewFindings, reviewStatus, startHere, displayUrl, isAttachable, validateReviewEditorial } from "./review-evidence";
import type { ModernizationOpportunity, OpportunityCategory } from "../business-intelligence/types";

let n = 0;
function opp(over: Partial<ModernizationOpportunity> & { observation: string }): ModernizationOpportunity {
  return {
    id: `o${n++}`, category: (over.category ?? "Customer Acquisition") as OpportunityCategory,
    observation: over.observation, whyItMatters: over.whyItMatters ?? "It affects how customers convert.",
    estimatedImpact: { level: over.estimatedImpact?.level ?? "High", rationale: over.estimatedImpact?.rationale ?? "Fix it." },
    confidence: over.confidence ?? { label: "Observed", score: 0.95 }, basis: over.basis ?? ["public website HTML"],
  };
}

describe("evidence invariants — no evidence, no finding", () => {
  it("a finding with EMPTY basis is dropped (no provenance → not sendable)", () => {
    const f = selectReviewFindings([opp({ observation: "No online booking on the site.", basis: [] })]);
    expect(f).toHaveLength(0);
    expect(reviewStatus(f)).toBe("INSUFFICIENT_EVIDENCE");
  });
  it("an INFERRED/LIKELY finding is dropped (guessed, not observed)", () => {
    expect(selectReviewFindings([opp({ observation: "No online booking.", confidence: { label: "Inferred", score: 0.4 } })])).toHaveLength(0);
    expect(selectReviewFindings([opp({ observation: "No online booking.", confidence: { label: "Likely", score: 0.6 } })])).toHaveLength(0);
  });
  it("SPECULATIVE / internal-inference language is rejected even at high confidence", () => {
    expect(selectReviewFindings([opp({ observation: "From the outside there's little sign of operational reporting or dashboards." })])).toHaveLength(0);
    expect(selectReviewFindings([opp({ observation: "Your systems may be inefficient and probably manual." })])).toHaveLength(0);
    expect(selectReviewFindings([opp({ observation: "Operational systems look developing." })])).toHaveLength(0);
  });
  it("NON-OBSERVABLE categories (internal ops/reporting/analytics) are dropped", () => {
    for (const category of ["Operations", "Internal Workflow", "Reporting", "Analytics"] as OpportunityCategory[]) {
      expect(selectReviewFindings([opp({ category, observation: "A concrete internal thing we cannot actually see." })])).toHaveLength(0);
    }
  });
  it("a genuine OBSERVED, publicly-visible finding survives with its evidence", () => {
    const f = selectReviewFindings([opp({ category: "Scheduling", observation: "The site has no online booking — reservations require a phone call during business hours.", basis: ["homepage HTML: no booking widget"] })], 3, { website: "https://acme.com", observedAt: "2026-08-14T00:00:00Z" });
    expect(f).toHaveLength(1);
    expect(f[0].evidence.confidence).toBe("Observed");
    expect(f[0].evidence.basis).toContain("homepage HTML: no booking widget"); // exact provenance retained
    expect(f[0].evidence.sourceUrl).toBe("https://acme.com");                    // exact internal URL
    expect(f[0].evidence.displayLabel).toBe("acme.com · Booking");               // clean client-facing
    expect(f[0].evidence.observedAt).toBe("2026-08-14T00:00:00Z");
  });
});

describe("quality — fewer is fine; never filler; no duplicates", () => {
  it("allows 1 or 2 findings (does NOT invent a third to hit a count)", () => {
    expect(selectReviewFindings([opp({ category: "Scheduling", observation: "No online booking on the site." })])).toHaveLength(1);
  });
  it("one-strong-finding policy: 1 Observed + High/Foundational → SENDABLE; weaker/Reported single → NEEDS_REVIEW", () => {
    // Approved policy: a single substantial, directly-observed finding stands on its own.
    const strong = selectReviewFindings([opp({ observation: "No online booking on the site.", estimatedImpact: { level: "Foundational", rationale: "x" }, confidence: { label: "Observed", score: 0.95 } })]);
    expect(reviewStatus(strong)).toBe("SENDABLE");
    // A single Moderate-impact finding is NOT substantial → still operator review.
    const moderate = selectReviewFindings([opp({ observation: "No online booking on the site.", estimatedImpact: { level: "Moderate", rationale: "x" }, confidence: { label: "Observed", score: 0.9 } })]);
    expect(reviewStatus(moderate)).toBe("NEEDS_REVIEW");
    // Third-party REPORTED (not directly observed) does not stand alone, even at High impact.
    const reported = selectReviewFindings([opp({ observation: "Customers report slow replies to enquiries.", estimatedImpact: { level: "High", rationale: "x" }, confidence: { label: "Reported", score: 0.8 } })]);
    expect(reviewStatus(reported)).toBe("NEEDS_REVIEW");
  });
  it("de-duplicates by category and by observation", () => {
    const f = selectReviewFindings([
      opp({ category: "Scheduling", observation: "No online booking." }),
      opp({ category: "Scheduling", observation: "Still no online booking anywhere." }), // same category
    ]);
    expect(f).toHaveLength(1);
  });
  it("status ladder: >=2 SENDABLE, 1 NEEDS_REVIEW, 0 INSUFFICIENT", () => {
    const two = selectReviewFindings([opp({ category: "Scheduling", observation: "No online booking on the site." }), opp({ category: "Brand Experience", observation: "The homepage has no clear primary call to action." })]);
    expect(reviewStatus(two)).toBe("SENDABLE");
    expect(reviewStatus([])).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("attachability gate — NEEDS_REVIEW can never silently attach", () => {
  it("SENDABLE is attachable with or without approval", () => {
    expect(isAttachable("SENDABLE", false)).toBe(true);
    expect(isAttachable("SENDABLE", true)).toBe(true);
  });
  it("NEEDS_REVIEW attaches ONLY after explicit approval", () => {
    expect(isAttachable("NEEDS_REVIEW", false)).toBe(false);
    expect(isAttachable("NEEDS_REVIEW", true)).toBe(true);
  });
  it("INSUFFICIENT_EVIDENCE is never attachable, even if 'approved' is forced", () => {
    expect(isAttachable("INSUFFICIENT_EVIDENCE", true)).toBe(false);
  });
});

describe("provenance survives into the finding (exact, two-layer)", () => {
  it("retains basis + exact source URL + observedAt, and a clean display label", () => {
    const f = selectReviewFindings(
      [opp({ category: "Customer Acquisition", observation: "The storefront lists 40+ collections, many empty or duplicated.", basis: ["storefront HTML: collection list", "sitemap.xml"] })],
      3,
      { website: "https://urbanamericana.com/collections?utm_source=x", observedAt: "2026-08-14T00:00:00Z" },
    )[0];
    expect(f.evidence.basis).toEqual(["storefront HTML: collection list", "sitemap.xml"]); // exact, internal
    expect(f.evidence.sourceUrl).toBe("https://urbanamericana.com/collections?utm_source=x"); // exact, internal
    expect(f.evidence.displayLabel).toBe("urbanamericana.com/collections · Catalog & navigation"); // clean, client-facing
    expect(f.evidence.observedAt).toBe("2026-08-14T00:00:00Z");
    expect(f.evidence.sourceType).toBe("website");
  });
  it("a reviews finding is sourced to the Google Business Profile", () => {
    const f = selectReviewFindings([opp({ category: "Customer Retention", observation: "Google reviews are strong (4.8, 900+) but none are surfaced on the site.", confidence: { label: "Reported", score: 0.7 }, basis: ["Google Business Profile"] })])[0];
    expect(f.evidence.sourceType).toBe("google-business");
    expect(f.evidence.displayLabel).toBe("Google Business Profile");
  });
});

describe("URL hygiene — no tracking noise in client-facing copy", () => {
  it("strips protocol, query/utm, and trailing slash", () => {
    expect(displayUrl("https://urbanamericana.com/?utm_source=x&utm_medium=y&utm_campaign=z")).toBe("urbanamericana.com");
    expect(displayUrl("http://example.com/shop/?ref=abc#top")).toBe("example.com/shop");
    expect(displayUrl(null)).toBeNull();
  });
});

describe("startHere — one prioritized starting point from the top finding", () => {
  it("returns a single labelled starting point, not three asks", () => {
    const f = selectReviewFindings([opp({ category: "Customer Acquisition", observation: "The catalog is split across obsolete collections that make browsing harder than it should be." })]);
    const s = startHere(f);
    expect(s).not.toBeNull();
    expect(s!.label).toMatch(/catalog|discovery|navigation|pass|cleanup/i);
    expect(s!.sourceFindingId).toBe(f[0].id);           // coherence anchor
    expect(startHere([])).toBeNull();
  });
});

// ── Urban Americana acceptance (a Shopify-style retail marketplace) — NO hard-coding ──────────────
describe("Urban Americana regression — specific observable findings, boilerplate dropped", () => {
  const urbanAmericanaBI: ModernizationOpportunity[] = [
    // Observable, specific (should SURVIVE):
    opp({ category: "Customer Acquisition", observation: "The Shopify storefront lists 40+ collections, many empty or duplicated, so browsing a large vintage catalog is harder than it needs to be.", basis: ["storefront HTML: collection list", "sitemap"], estimatedImpact: { level: "High", rationale: "Audit the collection structure, remove or index-control obsolete collections, consolidate duplicates, and rebuild the customer-facing taxonomy around how people actually shop." } }),
    opp({ category: "Brand Experience", observation: "On mobile the primary 'Shop' action sits below three stacked banners, so it's off-screen on first load.", basis: ["mobile render: above-the-fold capture"] }),
    opp({ category: "Customer Retention", observation: "Google reviews are strong (4.8, 900+) but none are surfaced on the site itself.", confidence: { label: "Reported", score: 0.7 }, basis: ["Google Business Profile", "site has no review module"] }),
    // Speculative internal guesses (the OLD boilerplate — should be DROPPED):
    opp({ category: "Reporting", observation: "From the outside there's little sign of operational reporting or dashboards.", confidence: { label: "Inferred", score: 0.4 }, basis: ["reporting not externally visible — inferred"] }),
    opp({ category: "Operations", observation: "Operational systems look developing.", confidence: { label: "Inferred", score: 0.4 }, basis: ["operational-maturity: weak"] }),
    opp({ category: "Analytics", observation: "There's no external sign of measuring what the presence returns.", confidence: { label: "Inferred", score: 0.4 }, basis: ["measurement not externally visible — inferred"] }),
  ];

  it("keeps the concrete, evidence-backed findings and drops every speculative one", () => {
    const findings = selectReviewFindings(urbanAmericanaBI);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.length).toBeLessThanOrEqual(3);
    const text = findings.map((f) => f.observation).join(" ");
    expect(text).toMatch(/collections/i);          // the real, specific catalog finding
    expect(text).not.toMatch(/dashboard|operational reporting|look developing|little sign|measuring what/i); // boilerplate gone
    for (const f of findings) expect(["Observed", "Reported"]).toContain(f.evidence.confidence);
    expect(reviewStatus(findings)).toBe("SENDABLE");
    // Top finding is the catalog one (longest/most specific) → catalog-coherent start label.
    expect(startHere(findings)!.label).toMatch(/catalog|discovery|navigation/i);
  });
});

// ── M3.1 editorial integrity — the four last-mile defects, by construction ─────────────────────────
describe("M3.1 — finding titles are unique and observation-specific (defect 1)", () => {
  it("mobile + catalog + reviews (all Customer Acquisition-ish) get THREE distinct titles", () => {
    const findings = selectReviewFindings([
      opp({ category: "Brand Experience", observation: "On mobile the primary 'Shop' action sits below three stacked banners, so it's off-screen on first load." }),
      opp({ category: "Customer Acquisition", observation: "The storefront exposes 19 customer-facing collections, but there is no filtering or faceted browsing to narrow a big catalog." }),
      opp({ category: "Customer Retention", observation: "The business has 950+ reviews at 4.8 stars externally, but none are surfaced on the site.", confidence: { label: "Reported", score: 0.7 }, basis: ["Google Business Profile"] }),
    ]);
    const titles = findings.map((f) => f.title);
    expect(new Set(titles.map((t) => t.toLowerCase())).size).toBe(titles.length); // all unique
    // No generic consulting fallback reused across unrelated findings.
    for (const t of titles) expect(t).not.toMatch(/own more of what customers|improve the website|improve conversion|strengthen customer experience/i);
    // Quantitative context strengthens the specific titles.
    expect(titles.join(" | ")).toMatch(/19 collections/i);
    expect(titles.join(" | ")).toMatch(/950\+ customer reviews/i);
  });
});

describe("M3.1 — semantic roles are separated (defect 2)", () => {
  it("whatWedDo is an ACTION, never a repeat impact statement — even when the engine's rationale is impact-shaped", () => {
    // Mimics the real mobile rule: rationale is an IMPACT sentence, not an action.
    const mobile = opp({ category: "Customer Acquisition", observation: "On mobile the primary action is pushed off-screen below stacked banners.", whyItMatters: "Most first visits happen on a phone; a site that struggles there loses customers before they make contact.", estimatedImpact: { level: "High", rationale: "Mobile experience directly gates how many visitors convert." } });
    const f = selectReviewFindings([mobile, opp({ category: "Customer Retention", observation: "950+ reviews at 4.8 stars are not surfaced on the site.", confidence: { label: "Reported", score: 0.7 }, basis: ["Google Business Profile"] })])[0];
    expect(f.whatWedDo).not.toBe("Mobile experience directly gates how many visitors convert."); // not the impact line
    expect(f.whatWedDo).toMatch(/\b(rework|audit|surface|simplify|add|remove|choose|standardi|replace|consolidate|prioriti|profile|cut|map|restructure|rebuild|test|instrument|redirect|redesign|clarify)\b/i);
    expect(f.whyItMatters).toMatch(/loses customers|first visits/i); // consequence stays in whyItMatters
  });
});

describe("M3.1 — the starting point is internally coherent (defect 3)", () => {
  it("when catalog outranks mobile, the start LABEL and RATIONALE both come from the catalog finding", () => {
    const findings = selectReviewFindings([
      opp({ category: "Customer Acquisition", observation: "The storefront exposes 19 customer-facing collections, but there is no filtering or faceted browsing to help narrow a big catalog." }),
      opp({ category: "Brand Experience", observation: "On mobile the primary action is off-screen below banners." }),
    ]);
    expect(findings[0].topic).toBe("catalog"); // catalog ranks first (longer/more specific)
    const s = startHere(findings)!;
    expect(s.sourceFindingId).toBe(findings[0].id);
    expect(s.label).toMatch(/catalog|discovery|navigation/i);      // label is catalog-flavored
    expect(s.why).not.toMatch(/phone|mobile/i);                     // rationale is NOT from the mobile finding
    expect(s.intervention).toBe(findings[0].whatWedDo);             // same-finding intervention
    expect(validateReviewEditorial(findings, s)).toHaveLength(0);   // structurally coherent
  });
  it("validator flags an incoherent hand-built starting point", () => {
    const findings = selectReviewFindings([
      opp({ category: "Customer Acquisition", observation: "The storefront exposes 19 collections with no filtering to narrow the catalog." }),
      opp({ category: "Brand Experience", observation: "On mobile the primary action is off-screen below banners." }),
    ]);
    const bad = { sourceFindingId: findings[0].id, label: "Mobile conversion pass", intervention: "something else", why: "x", proofReference: "x.com" };
    expect(validateReviewEditorial(findings, bad).length).toBeGreaterThan(0);
  });
});

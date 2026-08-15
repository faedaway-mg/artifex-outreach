// ─────────────────────────────────────────────────────────────────────────────
// Evidence-first Quick Review invariants. A finding cannot reach the client-facing review unless we
// can point to public evidence for it: directly observed / third-party reported, non-empty basis,
// publicly-observable, non-speculative. Speculative internal-operations guesses are dropped by
// construction. Includes the Urban Americana regression case (no company-specific hard-coding).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { selectReviewFindings, reviewStatus, startHere, displayUrl } from "./review-evidence";
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
    const f = selectReviewFindings([opp({ category: "Scheduling", observation: "The site has no online booking — reservations require a phone call during business hours.", basis: ["homepage HTML: no booking widget"] })]);
    expect(f).toHaveLength(1);
    expect(f[0].evidence.confidence).toBe("Observed");
    expect(f[0].evidence.source).toContain("booking widget");
  });
});

describe("quality — fewer is fine; never filler; no duplicates", () => {
  it("allows 1 or 2 findings (does NOT invent a third to hit a count)", () => {
    expect(selectReviewFindings([opp({ category: "Scheduling", observation: "No online booking on the site." })])).toHaveLength(1);
    expect(reviewStatus(selectReviewFindings([opp({ category: "Scheduling", observation: "No online booking." })]))).toBe("NEEDS_REVIEW");
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
    expect(s!.label).toMatch(/information-architecture|audit|cleanup|QA/i);
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
    expect(startHere(findings)!.label).toMatch(/information-architecture/i);
  });
});

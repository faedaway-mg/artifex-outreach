// ─────────────────────────────────────────────────────────────────────────────
// M3.1 hook system — text + visual hooks are EVIDENCE-derived, bounded, and never exaggerated.
// A stat hook uses a measured number; a comparison uses two measured sides; a screenshot hook needs a
// real capture; an excerpt needs a real fragment. Absent richer evidence, it falls back to TEXT_ONLY.
// No hook may use manufactured financial/loss language. Tested across business shapes.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { presentFindings, openingHook, selectVisualHook, hookHasExaggeration } from "./review-hooks";
import type { ReviewFinding } from "./review-evidence";

function finding(over: Partial<Omit<ReviewFinding, "evidence">> & { id: string; topic: ReviewFinding["topic"]; observation: string; evidence?: Partial<ReviewFinding["evidence"]> }): ReviewFinding {
  return {
    id: over.id, category: over.category ?? "Customer Acquisition", topic: over.topic, title: over.title ?? "T",
    observation: over.observation,
    evidence: { confidence: over.evidence?.confidence ?? "Observed", sourceType: "website", sourceUrl: "https://x.com", displayLabel: over.evidence?.displayLabel ?? "x.com · Section", basis: over.evidence?.basis ?? ["public website HTML"], observedAt: null, screenshotRef: over.evidence?.screenshotRef ?? null },
    whyItMatters: over.whyItMatters ?? "It affects how customers convert.", whatWedDo: over.whatWedDo ?? "Audit the site.", score: over.score ?? 1,
  };
}

const catalog = finding({ id: "c", topic: "catalog", observation: "The storefront exposes 19 customer-facing collections, but no filtering or faceted browsing to narrow a big catalog." });
const reviews = finding({ id: "r", topic: "reviews", category: "Customer Retention", observation: "The business has 950+ reviews at 4.8★ externally, but the crawled pages surface no comparable proof.", evidence: { confidence: "Reported", basis: ["external rating 4.8★ / 950 reviews", "no on-site review markup detected"] } });
const mobile = finding({ id: "m", topic: "mobile", observation: "On mobile the primary action sits below three stacked banners, so it's off-screen on first load." });
const test = finding({ id: "t", topic: "test-content", category: "Brand Experience", observation: "2 internal/test-style pages are publicly reachable.", evidence: { basis: ["link: https://x.com/collections/test-old-home"] } });

describe("text hooks — evidence-specific, distinct, no exaggeration", () => {
  it("each finding gets a text hook, and unrelated findings get DISTINCT hooks", () => {
    const p = presentFindings([mobile, catalog, reviews]);
    const hooks = p.map((x) => x.textHook);
    expect(hooks.every((h) => h.length > 0)).toBe(true);
    expect(new Set(hooks).size).toBe(hooks.length);           // no duplicate hooks across topics
  });
  it("quantitative context is retained in the hook when the evidence carries it", () => {
    const p = presentFindings([catalog, reviews]);
    expect(p[0].textHook).toMatch(/19/);
    expect(p[1].textHook).toMatch(/950/);
  });
  it("no text hook uses manufactured cost/loss/revenue language", () => {
    for (const x of presentFindings([mobile, catalog, reviews, test])) expect(hookHasExaggeration(x.textHook)).toBe(false);
  });
});

describe("visual hooks — bounded set, each mapped to real evidence", () => {
  it("a measured catalog count becomes a STRUCTURE hook built from that number", () => {
    const v = selectVisualHook(catalog);
    expect(v.type).toBe("STRUCTURE");
    expect(v.primaryValue).toBe("19");
    expect(v.structure?.[0]).toMatch(/19/);
  });
  it("external proof becomes a COMPARISON with BOTH measured sides and honest scope", () => {
    const v = selectVisualHook(reviews);
    expect(v.type).toBe("COMPARISON");
    expect(v.comparison?.left).toBe("950+");
    expect(v.comparison?.right).toBe("0");
    expect(v.comparison?.rightLabel).toMatch(/crawled/i);      // partial scope stated, not a site-wide absolute
  });
  it("a public test route becomes an EXCERPT taken from the exact basis", () => {
    const v = selectVisualHook(test);
    expect(v.type).toBe("EXCERPT");
    expect(v.evidenceExcerpt).toBe("test-old-home");
  });
  it("a real screenshotRef becomes a SCREENSHOT hook; nothing else fakes one", () => {
    const withShot = finding({ ...mobile, id: "m2", topic: "mobile", observation: mobile.observation, evidence: { screenshotRef: "data:image/png;base64,AAAA" } });
    expect(selectVisualHook(withShot).type).toBe("SCREENSHOT");
    // mobile with no number, no excerpt, no proof, no screenshot → TEXT_ONLY (no invented visual)
    const v = selectVisualHook(mobile);
    expect(v.type).toBe("TEXT_ONLY");
    expect(v.screenshotRef).toBeNull();
    expect(v.primaryValue).toBeNull();
  });
  it("a single top-level nav count becomes a STAT using only the measured number", () => {
    const nav = finding({ id: "n", topic: "navigation", observation: "The primary navigation exposes 14 top-level destinations." });
    const v = selectVisualHook(nav);
    expect(v.type).toBe("STAT");
    expect(v.primaryValue).toBe("14");
    expect(v.supportingLabel).toMatch(/top-level/i);
  });
});

describe("opening hook — the strongest hook, not mechanically Finding 01", () => {
  it("picks the quantified/contrast finding over a text-only lead finding", () => {
    // Order: mobile (TEXT_ONLY) first, then catalog (STRUCTURE), reviews (COMPARISON).
    const hook = openingHook([mobile, catalog, reviews]);
    expect(hook).not.toBe(presentFindings([mobile])[0].textHook); // not the mobile (Finding 01) hook
    expect(hook).toMatch(/19|950/);                                // a quantified hook won
  });
  it("returns null when there are no findings", () => {
    expect(openingHook([])).toBeNull();
  });
});

describe("cross-business generalization — no flashy stats invented for thin evidence", () => {
  it("a professional-service finding with no numbers falls back to TEXT_ONLY, still hooked", () => {
    const svc = finding({ id: "s", topic: "cta", observation: "The homepage has no single clear primary action." });
    const p = presentFindings([svc]);
    expect(p[0].visualHook.type).toBe("TEXT_ONLY");   // no number → no STAT invented
    expect(p[0].textHook.length).toBeGreaterThan(0);  // still gets a text hook
  });
  it("a simple brochure site (one soft finding) is not dressed up with fake visual stats", () => {
    const brochure = finding({ id: "b", topic: "brand", observation: "The business name appears in more than one form across the site.", evidence: { basis: ['name: "Acme Co"', 'on-page: "Acme"'] } });
    const v = selectVisualHook(brochure);
    expect(["EXCERPT", "TEXT_ONLY"]).toContain(v.type); // excerpt of the real fragment, or nothing — never a fake stat
    expect(v.primaryValue).toBeNull();
  });
});

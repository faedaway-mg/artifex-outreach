// ─────────────────────────────────────────────────────────────────────────────
// Urban Americana acceptance — through the GENERALIZED engine path, not a prewritten object.
// A realistic storefront is parsed by the REAL BI engine (analyzeBusiness), which now includes the
// M3 public-observation layer. The engine derives opportunities (including its speculative
// Reporting/Analytics inferences AND the new structure-aware observations), and the evidence-first
// selection must KEEP the observable findings and DROP every speculative one. No hard-coding: the
// finding text is never injected; we assert on whatever the engine actually discovers from the HTML.
// M3 target: a rich public footprint yields ≥2 distinct, high-confidence, observable findings.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { analyzeBusiness } from "../intelligence/engine";
import { makeLead } from "../test-lead";
import { selectReviewFindings } from "./review-evidence";
import { buildQuickReview } from "./quick-review";
import { renderQuickReviewPdf } from "../pdf/render";

// A realistic Urban Americana storefront with a RICH public footprint: a large collection index with
// no filtering, a duplicate category ("Lighting" twice under different paths), a leftover internal
// "test" collection reachable by the public, promo-heavy hero, NO mobile viewport, and reviews that
// live only on Google (nothing on-site). Public-shaped fixture — the closest legitimate offline
// source, since the test env has no network. The engine must DISCOVER, not be told.
const collectionIndex = [
  "furniture", "lighting", "decor", "rugs", "art", "mirrors", "seating", "tables",
  "storage", "textiles", "glassware", "ceramics", "vintage-signs", "records", "books",
  "jewelry", "clothing", "lighting-fixtures", // <- near-duplicate of "lighting"
].map((slug) => `<a href="/collections/${slug}">${slug === "lighting-fixtures" ? "Lighting" : slug.replace(/-/g, " ")}</a>`).join("");

const HTML = `<!doctype html><html><head><title>Urban Americana — Vintage Marketplace, Long Beach</title></head>
<body>
<nav><a href="/shop">Shop</a><a href="/collections">Collections</a><a href="/about">About</a><a href="/visit">Visit</a></nav>
<div class="promo">Summer Sale</div><div class="promo">New Arrivals</div><div class="promo">Vendor Spotlight</div>
<h1>Urban Americana</h1>
<h2>Shop Our Collections</h2>
${collectionIndex}
<a href="/collections/test-old-home">test-old-home</a>
<p>A 60,000 sq ft vintage marketplace with vendor booths, services, and events.</p>
</body></html>`;

const lead = makeLead({
  businessName: "Urban Americana", industry: "Vintage marketplace", normalizedCategory: "furniture-store",
  city: "Long Beach", state: "CA", website: "https://urbanamericana.com/?utm_source=artifex", websiteDomain: "urbanamericana.com",
  rating: 4.8, reviewCount: 950, publicEmail: null,
});

describe("Urban Americana — generalized engine path (M3)", () => {
  it("the REAL engine emits speculative Reporting/Analytics inferences (the old boilerplate)", async () => {
    const bi = await analyzeBusiness({ lead, pages: [{ url: "https://urbanamericana.com", html: HTML }] });
    const specul = bi.businessProfile.opportunities.filter((o) => o.confidence.label === "Inferred");
    expect(specul.some((o) => /reporting|dashboard|measuring|measurement/i.test(o.observation))).toBe(true);
  });

  it("evidence-first selection DROPS every speculative one and keeps only observable findings", async () => {
    const bi = await analyzeBusiness({ lead, pages: [{ url: "https://urbanamericana.com", html: HTML }] });
    const findings = selectReviewFindings(bi.businessProfile.opportunities, 3, { website: lead.website, observedAt: null });
    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      expect(["Observed", "Reported"]).toContain(f.evidence.confidence);
      expect(f.observation).not.toMatch(/dashboard|operational reporting|look developing|little sign|measuring what/i);
      expect(f.evidence.basis.length).toBeGreaterThan(0);     // exact provenance retained
    }
  });

  it("M3: a rich public footprint yields ≥2 DISTINCT high-confidence observable findings", async () => {
    const bi = await analyzeBusiness({ lead, pages: [{ url: "https://urbanamericana.com", html: HTML }] });
    const findings = selectReviewFindings(bi.businessProfile.opportunities, 3, { website: lead.website, observedAt: null });
    expect(findings.length).toBeGreaterThanOrEqual(2);
    // Distinct: no two findings share the same observation text.
    const texts = new Set(findings.map((f) => f.observation.trim().toLowerCase()));
    expect(texts.size).toBe(findings.length);
    // Every finding is directly observed and carries provenance.
    for (const f of findings) expect(f.evidence.confidence).toBe("Observed");
  });

  it("M3.1: the review carries a primary opening hook and an evidence-derived visual hook per finding", async () => {
    const bi = await analyzeBusiness({ lead, pages: [{ url: "https://urbanamericana.com", html: HTML }] });
    const review = buildQuickReview(lead, bi.businessProfile, null, { approved: true });
    expect(review.openingHook).toBeTruthy();
    // The opening is a SYNTHESIZING frame led by the strongest finding's topic — and, per the
    // editorial-quality fix, NEVER a verbatim copy of any finding's own hook.
    expect(review.presentations.map((p) => p.textHook)).not.toContain(review.openingHook);
    expect(review.presentations).toHaveLength(review.findings.length);
    for (const p of review.presentations) {
      expect(p.textHook.length).toBeGreaterThan(0);
      expect(["STAT", "COMPARISON", "SCREENSHOT", "EXCERPT", "STRUCTURE", "TEXT_ONLY"]).toContain(p.visualHook.type);
    }
    // The catalog finding's visual hook is built from the measured count (not invented).
    const catalog = review.presentations.find((p) => review.findings.find((f) => f.id === p.findingId)?.topic === "catalog");
    if (catalog) { expect(catalog.visualHook.type).toBe("STRUCTURE"); expect(catalog.visualHook.primaryValue).toMatch(/\d/); }
  });

  it("renders a valid PDF and normalizes the tracking URL for display", async () => {
    const bi = await analyzeBusiness({ lead, pages: [{ url: "https://urbanamericana.com", html: HTML }] });
    const review = buildQuickReview(lead, bi.businessProfile, null, { approved: true });
    expect(review.website).toBe("urbanamericana.com");        // utm stripped for the client
    const pdf = await renderQuickReviewPdf(review, "August 15, 2026");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

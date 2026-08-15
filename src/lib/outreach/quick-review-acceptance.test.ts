// ─────────────────────────────────────────────────────────────────────────────
// Urban Americana acceptance — through the GENERALIZED path, not a prewritten object.
// A realistic storefront is parsed by the real website intelligence, the real BI engine derives
// opportunities (including its speculative Reporting/Analytics inferences), and the evidence-first
// selection must KEEP the observable findings and DROP every speculative one. No hard-coding: the
// three-finding text is never injected; we assert on whatever the engine actually discovers.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { buildBusinessProfile } from "../business-intelligence/profile";
import { analyzeWebsitePages } from "../intelligence/providers/website-intelligence";
import { makeLead } from "../test-lead";
import { selectReviewFindings } from "./review-evidence";
import { buildQuickReview } from "./quick-review";
import { renderQuickReviewPdf } from "../pdf/render";
import type { ProfileInput } from "../business-intelligence/types";

// A realistic Urban Americana storefront: has a site, promo-heavy, NO mobile viewport, NO clear
// contact/booking path, collections present, reviews live only on Google. (Public-shaped fixture —
// the closest legitimate offline source, since the test env has no network.)
const HTML = `<!doctype html><html><head><title>Urban Americana — Vintage Marketplace, Long Beach</title></head>
<body><nav><a>Shop</a><a>Collections</a><a>About</a></nav>
<div class="promo">Summer Sale</div><div class="promo">New Arrivals</div><div class="promo">Vendor Spotlight</div>
<h1>Urban Americana</h1><h2>Our Collections</h2><a>Furniture</a><a>Lighting</a><a>Decor</a>
<p>A 60,000 sq ft vintage marketplace with vendor booths, services, and events.</p></body></html>`;

const lead = makeLead({
  businessName: "Urban Americana", industry: "Vintage marketplace", normalizedCategory: "furniture-store",
  city: "Long Beach", state: "CA", website: "https://urbanamericana.com/?utm_source=artifex", websiteDomain: "urbanamericana.com",
  rating: 4.8, reviewCount: 950, publicEmail: null,
});

describe("Urban Americana — generalized engine path", () => {
  const evidence = analyzeWebsitePages([{ url: "https://urbanamericana.com", html: HTML }]);
  const profile = buildBusinessProfile({ lead, evidence } as ProfileInput);

  it("the REAL engine emits speculative Reporting/Analytics inferences (the old boilerplate)", () => {
    const specul = profile.opportunities.filter((o) => o.confidence.label === "Inferred");
    expect(specul.some((o) => /reporting|dashboard|measuring|measurement/i.test(o.observation))).toBe(true);
  });

  it("evidence-first selection DROPS every speculative one and keeps only observable findings", () => {
    const findings = selectReviewFindings(profile.opportunities, 3, { website: lead.website, observedAt: null });
    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      expect(["Observed", "Reported"]).toContain(f.evidence.confidence);
      expect(f.observation).not.toMatch(/dashboard|operational reporting|look developing|little sign|measuring what/i);
      expect(f.evidence.basis.length).toBeGreaterThan(0);     // exact provenance retained
    }
  });

  it("renders a valid PDF and normalizes the tracking URL for display", async () => {
    const review = buildQuickReview(lead, profile, null, { approved: true });
    expect(review.website).toBe("urbanamericana.com");        // utm stripped for the client
    const pdf = await renderQuickReviewPdf(review, "August 15, 2026");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

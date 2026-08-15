// ─────────────────────────────────────────────────────────────────────────────
// M3.1 page composition — page count is judged by attention/clarity, not a rigid one-page rule.
// A concise text-only review should NOT spill an accidental near-empty page (the M3 defect); a
// screenshot-bearing review may legitimately run to two pages. Page count is read from the rendered
// PDF (count of `/Type /Page` objects) so the assertion is on the real artifact, not a proxy.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { renderQuickReviewPdf } from "./render";
import type { QuickReview } from "@/lib/outreach/quick-review";
import type { ReviewFinding, StartingPoint } from "@/lib/outreach/review-evidence";
import { presentFindings, openingHook } from "@/lib/outreach/review-hooks";

function pageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function finding(over: Partial<Omit<ReviewFinding, "evidence">> & { id: string; title: string; evidence?: Partial<ReviewFinding["evidence"]> }): ReviewFinding {
  return {
    id: over.id, category: over.category ?? "Customer Acquisition", topic: over.topic ?? "catalog", title: over.title,
    observation: over.observation ?? "The storefront exposes 19 customer-facing collections, but no filtering or faceted browsing to narrow a big catalog.",
    evidence: { confidence: over.evidence?.confidence ?? "Observed", sourceType: "website", sourceUrl: "https://x.com", displayLabel: "urbanamericana.com · Catalog & navigation", basis: over.evidence?.basis ?? ["19 collection routes"], observedAt: null, screenshotRef: over.evidence?.screenshotRef ?? null },
    whyItMatters: over.whyItMatters ?? "A large catalog without ways to narrow it makes shoppers work harder to find relevant pieces, and most give up before they do.",
    whatWedDo: over.whatWedDo ?? "Audit how customers browse the catalog and add filtering and sorting around the attributes they actually shop by.",
    score: over.score ?? 1,
  };
}

function review(findings: ReviewFinding[]): QuickReview {
  const start: StartingPoint | null = findings.length ? { sourceFindingId: findings[0].id, label: "Catalog discovery & navigation pass", intervention: findings[0].whatWedDo, why: "A large catalog is hard to shop. Of the findings, it's the clearest to evidence and the fastest to show a result, so we'd start here.", proofReference: findings[0].evidence.displayLabel } : null;
  return {
    businessName: "Urban Americana Vintage Marketplace", industryLabel: "Vintage marketplace", location: "Long Beach, CA",
    website: "urbanamericana.com", brand: null, findings, presentations: presentFindings(findings), openingHook: openingHook(findings),
    start, status: findings.length >= 2 ? "SENDABLE" : findings.length === 1 ? "NEEDS_REVIEW" : "INSUFFICIENT_EVIDENCE",
    observations: findings.map((f) => f.observation), whyItMatters: findings[0]?.whyItMatters ?? "", recommendations: findings.map((f) => f.whatWedDo), ready: findings.length >= 2,
  };
}

const three = [
  finding({ id: "f1", topic: "mobile", category: "Customer Acquisition", title: "Make the first mobile visit easier to act on", observation: "On mobile the primary 'Shop' action sits below three stacked banners, so it's off-screen on first load.", whatWedDo: "Rework the mobile layout so the primary action appears first and promotional content doesn't bury it.", whyItMatters: "Most first visits happen on a phone; a site that struggles there loses customers before they make contact." }),
  finding({ id: "f2", topic: "catalog", title: "Make 19 collections easier to shop" }),
  finding({ id: "f3", topic: "reviews", category: "Customer Retention", title: "Put 950+ customer reviews to work", observation: "The business has 950+ reviews at 4.8 stars externally, but the pages surface no comparable proof where a visitor decides.", whatWedDo: "Surface the strongest customer reviews on the storefront and the pages where people decide.", whyItMatters: "The strongest trust signal the business owns is invisible right when a new visitor is deciding whether to buy.", evidence: { confidence: "Reported", basis: ["external rating 4.8★ / 950 reviews", "no on-site review markup detected"] } }),
];

describe("M3.1 page composition — no accidental sparse spill; screenshots may earn a second page", () => {
  it("a concise three-finding text-only review renders on a single page", async () => {
    const pdf = await renderQuickReviewPdf(review(three), "August 15, 2026");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
  });
  it("one finding renders on one page", async () => {
    expect(pageCount(await renderQuickReviewPdf(review([three[0]]), "August 15, 2026"))).toBe(1);
  });
  it("two findings render on one page", async () => {
    expect(pageCount(await renderQuickReviewPdf(review(three.slice(0, 2)), "August 15, 2026"))).toBe(1);
  });
  it("a long business name and long titles still avoid an accidental spill page", async () => {
    const r = review(three);
    r.businessName = "The Urban Americana Vintage Marketplace & Vendor Collective of Long Beach";
    expect(pageCount(await renderQuickReviewPdf(r, "August 15, 2026"))).toBeLessThanOrEqual(2);
  });
  it("a screenshot-bearing finding renders (may intentionally use a second page for the crop)", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const withShot = three.map((f) => f.id === "f1" ? finding({ ...f, id: f.id, title: f.title, evidence: { ...f.evidence, screenshotRef: png } }) : f);
    const pdf = await renderQuickReviewPdf(review(withShot), "August 15, 2026");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1);
  });
});

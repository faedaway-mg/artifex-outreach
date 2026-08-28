import { describe, it, expect } from "vitest";
import { buildQuickReview, quickReviewFilename, type ResolvedBrand } from "./quick-review";
import { renderQuickReviewPdf } from "../pdf/render";
import type { Lead } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";

const lead = (over: Partial<Lead> = {}): Lead =>
  ({ id: "l1", businessName: "Villa Brasil Motel", industry: "motel", city: "Los Angeles", state: "CA", website: "https://villabrasil.example", ...over }) as Lead;

// An evidence-backed opportunity (Observed/Reported + non-empty basis) — the kind that survives.
type OppSeed = { category?: string; observation: string; whyItMatters: string; rationale: string; confidence?: "Observed" | "Reported" | "Likely" | "Inferred"; basis?: string[] };
const CATS = ["Customer Acquisition", "Scheduling", "Communication", "Customer Retention", "Brand Experience"];
const profile = (opps: OppSeed[]): BusinessProfile =>
  ({
    executiveSummary: "A well-reviewed motel whose bookings run through third parties.",
    opportunities: opps.map((o, i) => ({
      id: `o${i}`, category: o.category ?? CATS[i % CATS.length], observation: o.observation, whyItMatters: o.whyItMatters,
      estimatedImpact: { level: "High", rationale: o.rationale },
      confidence: { label: o.confidence ?? "Observed", score: 0.9 }, basis: o.basis ?? ["public website HTML"],
    })),
  } as unknown as BusinessProfile);

describe("buildQuickReview — deterministic, business-specific, never fabricated", () => {
  it("maps real BI opportunities into observations / why / recommendations", () => {
    const p = profile([
      { observation: "No owned website — a Google listing is doing the work.", whyItMatters: "New guests can't book on a site you control.", rationale: "A simple booking page could capture direct reservations." },
      { observation: "Reviews are strong but live on Google.", whyItMatters: "That reputation isn't reinforcing your own brand.", rationale: "Surfacing reviews on-site builds trust at the decision moment." },
    ]);
    const r = buildQuickReview(lead(), p, null);
    expect(r.businessName).toBe("Villa Brasil Motel"); // "Brasil", from the lead — never hard-coded
    expect(r.observations).toHaveLength(2);
    expect(r.observations[0]).toMatch(/No owned website/);
    expect(r.whyItMatters).toMatch(/can't book/);
    // whatWedDo is now the topic-specific intervention (M3.1), not the raw seed rationale — the
    // "owned website / Google listing" observation maps to the owned-presence intervention.
    expect(r.recommendations[0]).toMatch(/owned website|home base/i);
    expect(r.ready).toBe(true);
  });

  it("NEEDS_REVIEW (one finding) is NOT ready without approval, and ready once approved", () => {
    const p = profile([{ observation: "The site has no online booking; reservations need a phone call.", whyItMatters: "After-hours demand slips away.", rationale: "Add online booking." }]);
    expect(buildQuickReview(lead(), p, null).status).toBe("NEEDS_REVIEW");
    expect(buildQuickReview(lead(), p, null).ready).toBe(false);              // can't silently attach
    expect(buildQuickReview(lead(), p, null, { approved: true }).ready).toBe(true); // explicit approval
    // A speculative-only profile is INSUFFICIENT and can never be waved through.
    const spec = profile([{ observation: "Operational systems look developing.", whyItMatters: "x", rationale: "y", confidence: "Inferred" }]);
    expect(buildQuickReview(lead(), spec, null, { approved: true }).ready).toBe(false);
  });

  it("is NOT ready when there are no credible findings (no fabrication)", () => {
    const r = buildQuickReview(lead(), profile([]), null);
    expect(r.observations).toHaveLength(0);
    expect(r.ready).toBe(false);
  });

  it("caps at three observations", () => {
    // Six DISTINCT-topic observations (dedupe is by topic) — the cap, not dedupe, must limit to three.
    const many = [
      { observation: "The catalog exposes 40 collections with no filtering to narrow them.", whyItMatters: "w", rationale: "r" },
      { observation: "On mobile the primary action is off-screen below stacked banners.", whyItMatters: "w", rationale: "r" },
      { observation: "The homepage has no clear primary call to action for a first-time visitor.", whyItMatters: "w", rationale: "r" },
      { observation: "The site has no online booking; reservations require calling.", whyItMatters: "w", rationale: "r" },
      { observation: "Strong reviews live on Google but none are surfaced on the site.", whyItMatters: "w", rationale: "r" },
      { observation: "The primary navigation exposes 14 top-level destinations.", whyItMatters: "w", rationale: "r" },
    ];
    expect(buildQuickReview(lead(), profile(many), null).observations).toHaveLength(3);
  });

  it("includes a resolved logo when supplied, and falls back to name treatment when null", () => {
    const brand: ResolvedBrand = { logoUrl: "https://villabrasil.example/logo.png", sourceType: "apple-touch-icon", confidence: 0.9 };
    expect(buildQuickReview(lead(), profile([{ observation: "x", whyItMatters: "y", rationale: "z" }]), brand).brand).toEqual(brand);
    expect(buildQuickReview(lead(), profile([{ observation: "x", whyItMatters: "y", rationale: "z" }]), null).brand).toBeNull();
  });

  it("produces a professional, sanitized filename with no IDs", () => {
    expect(quickReviewFilename("Villa Brasil Motel")).toBe("Villa Brasil Motel — Artifex Quick Review.pdf");
    expect(quickReviewFilename('A/B: "Weird"?<name>')).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("renders a real one-page PDF buffer", async () => {
    const r = buildQuickReview(lead(), profile([{ observation: "No owned website.", whyItMatters: "Guests can't book directly.", rationale: "Add a booking page." }]), null);
    const buf = await renderQuickReviewPdf(r, "August 9, 2026");
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-"); // a valid PDF
  }, 120000);

  it("renders a valid PDF WITH an embedded data-URI logo (no remote fetch at render)", async () => {
    // 1x1 transparent PNG as a data URI — the shape resolveLeadBrand now caches.
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const brand: ResolvedBrand = { logoUrl: png, sourceType: "apple-touch-icon", confidence: 0.9 };
    const r = buildQuickReview(lead(), profile([{ observation: "Reviews live on Google.", whyItMatters: "Reputation isn't on a site you own.", rationale: "Surface reviews on-site." }]), brand);
    const buf = await renderQuickReviewPdf(r, "August 9, 2026");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 120000);

  it("still renders a valid one-page PDF when content is sparse (no blank/throw)", async () => {
    const r = buildQuickReview(lead(), profile([]), null); // not ready, but must not throw
    const buf = await renderQuickReviewPdf(r, "August 9, 2026");
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 120000);
});

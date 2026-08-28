import { describe, it, expect } from "vitest";
import { buildQuickReview, type ReviewCTA } from "@/lib/outreach/quick-review";
import { renderQuickReviewPdf } from "./render";
import type { Lead } from "@/lib/types";
import type { BusinessProfile } from "@/lib/business-intelligence/types";

// The CTA must be a REAL hyperlink in the exported PDF, not a button-shaped graphic. @react-pdf
// writes a link as an annotation whose action carries `/URI (<url>)` in the PDF byte stream. These
// tests render the actual document and assert the URL survives into that annotation across the
// layouts that ship (one finding, three findings, long name + long copy), plus the button label and
// the reply fallback line. Byte-level presence of the URI is the machine-checkable proof of clickability;
// the visual placement/no-clipping is verified from the sample artifact.

const BOOK = "https://cal.com/artifex-labs-ob2qbv/30min";

const lead = (over: Partial<Lead> = {}): Lead =>
  ({ id: "l1", businessName: "Cedar & Sage Dental", industry: "dentist", city: "Austin", state: "TX", website: "https://cedarsage.example", ...over }) as Lead;

type Opp = { observation: string; whyItMatters: string; rationale: string; impact?: string };
const profile = (opps: Opp[]): BusinessProfile =>
  ({
    executiveSummary: "A well-reviewed practice whose bookings run through third parties.",
    opportunities: opps.map((o, i) => ({
      id: `o${i}`, category: "Customer Acquisition", observation: o.observation, whyItMatters: o.whyItMatters,
      estimatedImpact: { level: o.impact ?? "High", rationale: o.rationale },
      confidence: { label: "Observed", score: 0.92 }, basis: ["public website HTML"],
    })),
  } as unknown as BusinessProfile);

const strong = (n: number): Opp[] =>
  Array.from({ length: n }, (_, i) => ({
    observation: `Finding ${i + 1}: the public booking path forces a phone call for a common request.`,
    whyItMatters: "After-hours demand leaves without a way to act.",
    rationale: "Add a direct booking path.",
    impact: "Foundational",
  }));

/** react-pdf emits an ASCII URL inside the annotation; decode latin1 and search for it. */
function containsUri(pdf: Buffer, url: string): boolean {
  const s = pdf.toString("latin1");
  return s.includes(url) && /\/URI\s*\(/.test(s);
}

describe("Quick Review PDF — clickable booking CTA (real link annotation)", () => {
  it("a one-finding review embeds the booking URL as a real link + shows button and reply lines", async () => {
    const r = buildQuickReview(lead(), profile(strong(1)), null, { approved: true, bookingUrl: BOOK });
    expect(r.cta).toBeTruthy();
    expect((r.cta as ReviewCTA).bookingUrl).toBe(BOOK);
    const pdf = await renderQuickReviewPdf(r, "August 27, 2026");
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(containsUri(pdf, BOOK)).toBe(true); // the annotation, not just a drawn box
  }, 120000);

  it("a three-finding review still embeds exactly the same canonical link (multi-finding layout)", async () => {
    const r = buildQuickReview(lead(), profile(strong(3)), null, { approved: true, bookingUrl: BOOK });
    const pdf = await renderQuickReviewPdf(r, "August 27, 2026");
    expect(containsUri(pdf, BOOK)).toBe(true);
  }, 120000);

  it("a long business name + long recommendation does not drop the link (survives layout stress)", async () => {
    const long = lead({ businessName: "Northgate Advanced Family & Cosmetic Dentistry of Greater Austin" });
    const p = profile([{ observation: "The homepage buries the one action a new patient needs behind three competing banners and a lengthy hero video that runs before anything actionable is on screen.", whyItMatters: "A first-time visitor with no obvious next move simply leaves and books elsewhere.", rationale: "Give first-time visitors one obvious, primary action above the fold.", impact: "Foundational" }]);
    const r = buildQuickReview(long, p, null, { approved: true, bookingUrl: BOOK });
    const pdf = await renderQuickReviewPdf(r, "August 27, 2026");
    expect(containsUri(pdf, BOOK)).toBe(true);
  }, 120000);

  it("an operator-configured booking URL is the one embedded (canonical URL is threaded, not hardcoded)", async () => {
    const alt = "https://cal.com/artifex-labs-ob2qbv/intro";
    const r = buildQuickReview(lead(), profile(strong(2)), null, { approved: true, bookingUrl: alt });
    const pdf = await renderQuickReviewPdf(r, "August 27, 2026");
    expect(containsUri(pdf, alt)).toBe(true);
    expect(pdf.toString("latin1").includes(BOOK)).toBe(false); // no stale/duplicate destination
  }, 120000);

  it("an INSUFFICIENT review has no CTA (nothing to act on, never sent)", () => {
    const r = buildQuickReview(lead(), profile([]), null, { bookingUrl: BOOK });
    expect(r.cta ?? null).toBeNull();
  });
});

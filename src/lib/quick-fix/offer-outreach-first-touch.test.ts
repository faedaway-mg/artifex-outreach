// ─────────────────────────────────────────────────────────────────────────────
// FIRST-TOUCH QUICK-CASH EMAIL — evidence-first / value-before-price rework.
//
// Proves the reworked default first-touch body + the attach-vs-link policy:
//   • FIRST sentence === experienceFrameForOffer(offer).emailOpener (the ONE shared
//     opener) — attempted-use ("I tried…") ONLY when the defect implies an attempt;
//     a passive-observation offer yields the honest observational opener, never "I tried".
//   • NO forbidden default openers ("we reviewed your website", etc.).
//   • NO price in the default first-touch body.
//   • NO raw offer/video/booking URL in the customer-visible body while hrefs stay correct.
//   • Effort line claims ONLY assets that exist (no video claimed when MISSING).
//   • Signature (configured sender identity) preserved.
//   • PDF attaches when small+ready; becomes LINKED when oversized/stale/mismatched;
//     MP4 is never auto-attached; filename === "[Business] — Website Review.pdf" (no ID).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

// The attachment policy renders the PDF via the diagnostic-pdf seam and reads the
// evidence package. Mock BOTH so these are pure, DB-free, and deterministic.
let mockPkg: any = null;
let mockPdfBytes: Buffer | null = null;
let renderThrows = false;

vi.mock("./evidence-package", async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, buildEvidencePackage: vi.fn(async () => mockPkg) };
});
vi.mock("./diagnostic-pdf", async (orig) => {
  const actual = await (orig as any)().catch(() => ({}));
  return {
    ...actual,
    renderDiagnosticPdfBuffer: vi.fn(async () => {
      if (renderThrows) throw new Error("render failed");
      return mockPdfBytes;
    }),
    diagnosticPdfFilename: vi.fn((offer: any) => `${offer.companyName} — Website Review.pdf`),
  };
});

import { composeOfferOutreach } from "./offer-outreach";
import { experienceFrameForOffer } from "./experience-frame";
import {
  buildOutreachAttachments,
  outreachPdfFilename,
  DEFAULT_ATTACHMENT_MAX_BYTES,
} from "./email-attachment-policy";
import type { QuickFixOffer } from "./types";

const PDF_HEADER = Buffer.from("%PDF-1.7\n");
const pdfOfSize = (n: number) => Buffer.concat([PDF_HEADER, Buffer.alloc(Math.max(0, n - PDF_HEADER.length), 0x20)]);

// Minimal eligible offer fixture; `problem`/`solution` drive the experience frame.
function offerWith(problem: string, solution = "Add a working path so visitors can do it.", over: Partial<QuickFixOffer> = {}): QuickFixOffer {
  return {
    offerId: "offer_abc",
    leadId: "lead_1",
    companyName: "Acme Roofing",
    findingIds: ["f1"],
    capabilityKeys: [],
    band: "ENTRY",
    priceCents: 24900,
    currency: "usd",
    scope: {
      offerName: "48-Hour Fix",
      problemBeingSolved: problem,
      proposedSolution: solution,
      includedItems: ["the fix"],
      excludedItems: ["unrelated redesign"],
      customerInputsRequired: ["site access"],
      deliveryWindow: "Delivered within 48 hours of receiving access",
      revisionPolicy: "one revision",
    },
    evidenceGrade: "OBSERVED",
    confidence: 0.9,
    rationale: "op-facing",
    economics: {} as any,
    maintenance: null,
    quickFixEligible: true,
    notEligibleReason: null,
    automationLevel: "ASSISTED",
    offerVersion: "v1",
    state: "APPROVED",
    generatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

const LINKS = {
  buyUrl: "https://app.artifexlabs.tech/offer/share_tok_123",
  bookingUrl: "https://cal.com/artifex-labs-ob2qbv/30min",
  videoUrl: "https://app.artifexlabs.tech/video/share_tok_123",
};

// A defect that DOES imply an attempted action (booking/contact family).
const BOOKING = offerWith("Visitors can't book an appointment online — there's no booking option.", "Add an online booking path.");
// A passive-observation defect (readability) — attemptSupported must be false.
const READABILITY = offerWith("Some of the body text is too small and hard to read on the pages we checked.", "Increase the font size and contrast.");

const pkgFor = (offer: QuickFixOffer, over: any = {}) => ({
  offerId: offer.offerId,
  leadId: offer.leadId,
  company: offer.companyName,
  websiteUrl: "https://acme-roofing.example",
  screenshots: [],
  screenshotStatus: "READY",
  findings: [{ id: "f1" }],
  personalizedVideo: { status: "MISSING", url: null, detail: "" },
  diagnosticPdf: { status: "READY", url: `/api/quick-fix/${offer.offerId}/diagnostic-pdf`, detail: "" },
  evergreenVideo: { status: "NOT_APPLICABLE", url: null, detail: "" },
  confidence: 0.9,
  evidenceGrade: "OBSERVED",
  generatedAt: null,
  ...over,
});

beforeEach(() => {
  mockPkg = pkgFor(BOOKING);
  mockPdfBytes = pdfOfSize(50_000);
  renderThrows = false;
  delete process.env.OUTREACH_ATTACHMENT_MAX_BYTES;
});

const FORBIDDEN = [
  "we reviewed your website",
  "we analyzed",
  "during our audit",
  "we noticed an optimization opportunity",
  "our team evaluated",
];

// ── BODY: opener ───────────────────────────────────────────────────────────────
describe("first-touch body opener is the shared experience frame", () => {
  it("first sentence === experienceFrameForOffer(offer).emailOpener", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS);
    const opener = experienceFrameForOffer(BOOKING).emailOpener;
    expect(copy.bodyText.split("\n\n")[0]).toBe(opener);
    // HTML leads with the same opener as its first paragraph.
    expect(copy.bodyHtml.indexOf(opener)).toBeGreaterThanOrEqual(0);
    expect(copy.bodyHtml.indexOf("<p>")).toBeLessThan(copy.bodyHtml.indexOf(opener));
  });

  it("attempted-use opener ONLY when the defect supports an attempt (booking → 'I tried')", () => {
    const frame = experienceFrameForOffer(BOOKING);
    expect(frame.attemptSupported).toBe(true);
    const copy = composeOfferOutreach(BOOKING, LINKS);
    expect(copy.bodyText).toMatch(/^I tried to /);
  });

  it("passive-observation offer yields the observational opener — never 'I tried'", () => {
    const frame = experienceFrameForOffer(READABILITY);
    expect(frame.attemptSupported).toBe(false);
    const copy = composeOfferOutreach(READABILITY, LINKS);
    expect(copy.bodyText.split("\n\n")[0]).toBe(frame.emailOpener);
    expect(copy.bodyText).not.toMatch(/I tried to/i);
  });

  it("never emits a forbidden default opener", () => {
    for (const offer of [BOOKING, READABILITY]) {
      const copy = composeOfferOutreach(offer, LINKS);
      const hay = copy.bodyText.toLowerCase();
      for (const f of FORBIDDEN) expect(hay).not.toContain(f);
    }
    // Specifically the named forbidden phrase.
    expect(composeOfferOutreach(BOOKING, LINKS).bodyText.toLowerCase()).not.toContain("we reviewed your website");
  });
});

// ── BODY: no price ─────────────────────────────────────────────────────────────
describe("no price in the default first-touch body", () => {
  it("body has no dollar amount and no '$249' / 'flat'", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS);
    expect(copy.bodyText).not.toMatch(/\$\s?\d/);
    expect(copy.bodyText.toLowerCase()).not.toContain("flat");
    expect(copy.bodyHtml).not.toMatch(/\$\s?\d/);
  });
});

// ── BODY: links are labels, hrefs correct, no raw URLs visible ─────────────────
describe("links use friendly labels; raw URLs never appear in the visible body", () => {
  it("visible text carries labels, not raw offer/video/booking URLs", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS, { assets: { pdf: "LINKED", video: "LINKED" } });
    // Visible (text) body: no raw URLs.
    expect(copy.bodyText).not.toContain(LINKS.buyUrl);
    expect(copy.bodyText).not.toContain(LINKS.videoUrl);
    expect(copy.bodyText).not.toContain(LINKS.bookingUrl);
    expect(copy.bodyText).not.toMatch(/https?:\/\//);
    // Friendly labels present.
    expect(copy.bodyText).toMatch(/Watch the website review →/);
    expect(copy.bodyText).toMatch(/Book a conversation →/);
  });

  it("HTML hrefs stay correct even though visible labels hide the URLs", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS, { assets: { pdf: "LINKED", video: "LINKED" } });
    // hrefs are the real URLs...
    expect(copy.bodyHtml).toContain(`href="${LINKS.videoUrl}"`);
    expect(copy.bodyHtml).toContain(`href="${LINKS.bookingUrl}"`);
    // ...but the URL never appears as visible link TEXT (>URL<).
    expect(copy.bodyHtml).not.toContain(`>${LINKS.buyUrl}<`);
    expect(copy.bodyHtml).not.toContain(`>${LINKS.bookingUrl}<`);
  });

  it("no-video offer routes the primary link to the offer page (buyUrl) with a 'See what I found' label", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS, { assets: { pdf: "ATTACHED", video: "MISSING" } });
    expect(copy.bodyText).toMatch(/See what I found →/);
    expect(copy.bodyText).not.toMatch(/Watch the website review/);
    expect(copy.bodyHtml).toContain(`href="${LINKS.buyUrl}"`);
  });
});

// ── BODY: proof-of-effort claims only assets that exist ────────────────────────
describe("proof-of-effort line only claims assets that actually exist", () => {
  it("claims BOTH video + attached PDF when both exist", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS, { assets: { pdf: "ATTACHED", video: "LINKED" } });
    expect(copy.bodyText).toMatch(/I made a short video/);
    expect(copy.bodyText).toMatch(/attached a one-page review/);
  });

  it("does NOT claim a video when the video is MISSING", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS, { assets: { pdf: "LINKED", video: "MISSING" } });
    expect(copy.bodyText).not.toMatch(/I made a short video/i);
    expect(copy.bodyText).toMatch(/one-page review/);
  });

  it("claims nothing when neither asset exists (no fabricated proof)", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS, { assets: { pdf: "MISSING", video: "MISSING" } });
    expect(copy.bodyText).not.toMatch(/short video/i);
    expect(copy.bodyText).not.toMatch(/one-page review/i);
  });
});

// ── BODY: signature preserved ──────────────────────────────────────────────────
describe("signature (configured sender identity) is preserved", () => {
  it("default signature is 'Jordan Jackson' / 'Artifex Labs'", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS);
    expect(copy.bodyText).toContain("Jordan Jackson\nArtifex Labs");
    expect(copy.bodyHtml).toContain("Jordan Jackson");
    expect(copy.bodyHtml).toContain("Artifex Labs");
  });

  it("a configured sender identity overrides the default", () => {
    const copy = composeOfferOutreach(BOOKING, LINKS, { sender: { name: "Sam Lee", company: "Artifex Labs" } });
    expect(copy.bodyText).toContain("Sam Lee\nArtifex Labs");
  });
});

// ── ATTACHMENT POLICY ──────────────────────────────────────────────────────────
describe("attachment policy: attach-vs-link decision + manifest", () => {
  it("attaches the PDF when it is small + ready + bound; manifest says ATTACHED", async () => {
    mockPdfBytes = pdfOfSize(50_000);
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.pdf).toBe("ATTACHED");
    expect(res.manifest.pdfReason).toBeNull();
    expect(res.attachment).not.toBeNull();
    expect(res.attachment!.contentType).toBe("application/pdf");
    expect(res.attachment!.bytes).toBe(50_000);
  });

  it("becomes LINKED (not ATTACHED) when the PDF is oversized — never silently attached", async () => {
    process.env.OUTREACH_ATTACHMENT_MAX_BYTES = "10000";
    mockPdfBytes = pdfOfSize(50_000);
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.pdf).toBe("LINKED");
    expect(res.manifest.pdfReason).toBe("oversized");
    expect(res.attachment).toBeNull();
    expect(res.manifest.pdfLinkUrl).toContain("/diagnostic-pdf");
  });

  it("default size ceiling is 8 MB and is honored", async () => {
    expect(DEFAULT_ATTACHMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
    mockPdfBytes = pdfOfSize(DEFAULT_ATTACHMENT_MAX_BYTES + 1);
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.pdf).toBe("LINKED");
    expect(res.manifest.pdfReason).toBe("oversized");
  });

  it("does NOT attach a PDF bound to a DIFFERENT offer (mismatched → LINKED)", async () => {
    mockPkg = pkgFor(BOOKING, { offerId: "some_other_offer" });
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.pdf).toBe("LINKED");
    expect(res.manifest.pdfReason).toBe("mismatched");
    expect(res.attachment).toBeNull();
  });

  it("does NOT attach when there are no findings (not renderable → MISSING/LINKED)", async () => {
    mockPkg = pkgFor(BOOKING, { findings: [], diagnosticPdf: { status: "MISSING", url: null, detail: "" } });
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.pdf).toBe("MISSING");
    expect(res.manifest.pdfReason).toBe("not-renderable");
    expect(res.attachment).toBeNull();
  });

  it("does NOT attach non-PDF bytes (bad MIME → LINKED)", async () => {
    mockPdfBytes = Buffer.from("<html>not a pdf</html>");
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.pdf).toBe("LINKED");
    expect(res.manifest.pdfReason).toBe("bad-mime");
  });

  it("render failure falls back to LINKED, never a broken attach", async () => {
    renderThrows = true;
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.pdf).toBe("LINKED");
    expect(res.manifest.pdfReason).toBe("render-failed");
    expect(res.attachment).toBeNull();
  });

  it("MP4 video is NEVER auto-attached — video is LINKED or MISSING only", async () => {
    // With an evergreen video present it is LINKED (a link), never an attachment.
    mockPkg = pkgFor(BOOKING, { evergreenVideo: { status: "READY", url: "https://cdn/evergreen.mp4", detail: "" } });
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.video).toBe("LINKED");
    expect(res.manifest.videoLinkUrl).toBe("https://cdn/evergreen.mp4");
    // The ONLY attachment is the PDF; nothing is a video/mp4.
    if (res.attachment) expect(res.attachment.contentType).toBe("application/pdf");
    // No personalized video pipeline → personalized stays MISSING; still no attach.
    mockPkg = pkgFor(BOOKING); // evergreen NOT_APPLICABLE, personalized MISSING
    const res2 = await buildOutreachAttachments(BOOKING);
    expect(res2.manifest.video).toBe("MISSING");
  });

  it("professional filename is '[Business] — Website Review.pdf' with NO internal id", async () => {
    const name = outreachPdfFilename(BOOKING);
    expect(name).toBe("Acme Roofing — Website Review.pdf");
    expect(name).not.toContain("offer_abc");
    expect(name).not.toContain("lead_1");
    const res = await buildOutreachAttachments(BOOKING);
    expect(res.manifest.filename).toBe("Acme Roofing — Website Review.pdf");
    expect(res.attachment!.filename).toBe("Acme Roofing — Website Review.pdf");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PER-OFFER DIAGNOSTIC PDF — one evidence truth, presented as a document.
//
// Proves: the PDF builder consumes the offer's SAME EvidencePackage findings and
// screenshot objects (never re-derives its own); no assembled customer-facing text
// trips the fabrication guard; a finding whose text WOULD be fabricated is DROPPED
// (not softened); an embedded screenshot is only the READY package screenshot; and
// evidence-package.diagnosticPdf is READY when findings exist / MISSING when none.
// A smoke render confirms the whole pipe produces a real PDF Buffer.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the read-only external dependencies exactly as evidence-package.test.ts does,
//    plus the artifact store used at RENDER time to read screenshot bytes. ─────────────
const mockLead: { website: string | null } = { website: "https://acme-roofing.example" };
let mockOpportunities: any[] = [];
let mockReadyShots: Record<string, any> = {};

vi.mock("../repo", () => ({
  getLead: vi.fn(async (_id: string) => mockLead),
  getBusinessIntelligence: vi.fn(async (_leadId: string) => ({
    profile: { businessProfile: { opportunities: mockOpportunities } },
  })),
}));

vi.mock("../content-studio/screenshot-jobs", () => ({
  latestReadyShot: vi.fn(async (_businessId: string, viewport: "mobile" | "desktop") => mockReadyShots[viewport] ?? null),
}));

// The render path reads real captured bytes; return a tiny valid PNG for any key.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
vi.mock("../content-studio/storage-factory", () => ({
  getArtifactStore: () => ({
    getMeta: vi.fn(async (_k: string) => ({ contentType: "image/png", sha256: "abc123", size: PNG_1x1.length })),
    readFull: vi.fn(async (_k: string) => PNG_1x1),
  }),
}));

import { buildEvidencePackage } from "./evidence-package";
import {
  assembleDiagnosticDoc,
  renderDiagnosticPdf,
  renderDiagnosticPdfBuffer,
  diagnosticPdfFilename,
} from "./diagnostic-pdf";
import { containsFabricatedClaim } from "./evidence-gate";
import { experienceFrameForOffer } from "./experience-frame";
import { generateOffer } from "./offer-engine";
import type { OfferFinding } from "./types";

const gen = (findings: OfferFinding[]) =>
  generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings, generatedAt: "2026-09-01T00:00:00Z" });

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});
const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile", category: "Customer Acquisition" });

const readyShot = (viewport: "mobile" | "desktop") => ({
  id: `csshot_${viewport}`, businessId: "lead_1", pieceId: null,
  requestedUrl: "https://acme-roofing.example/", canonicalUrl: "https://acme-roofing.example/",
  viewport, status: "ready", progress: 100, stage: "done",
  finalUrl: "https://acme-roofing.example/", capturedAt: "2026-09-01T10:00:00Z",
  contentType: "image/png", byteSize: 1234, sha256: "abc123", outputKey: `key/${viewport}.png`,
  provenance: null, error: null, attempt: 1, createdAt: "", updatedAt: "", startedAt: null, finishedAt: "2026-09-01T10:00:00Z",
});

beforeEach(() => {
  mockLead.website = "https://acme-roofing.example";
  mockOpportunities = [{
    id: "cta", category: "Customer Acquisition",
    observation: "the primary CTA button is hard to find on mobile",
    whyItMatters: "visitors can't easily take the next step",
    confidence: { label: "Observed", score: 0.95 }, basis: ["link: https://x"],
    estimatedImpact: { level: "High" },
  }];
  mockReadyShots = {};
});

describe("the diagnostic PDF consumes the offer's SAME evidence package (one evidence truth)", () => {
  it("uses the package's exact finding text + screenshot object — no re-derived findings", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg, "share_tok_123");

    // Same count + same ids as the package findings — nothing invented, nothing extra.
    expect(doc.findings.length).toBe(pkg.findings.length);
    expect(doc.findings.map((f) => f.id)).toEqual(pkg.findings.map((f) => f.id));

    // The observed/whyItMatters are the EXACT package finding fields.
    const pf = pkg.findings[0];
    const df = doc.findings[0];
    expect(df.observed).toBe(pf.plain);
    expect(df.whyItMatters).toBe(pf.whyItMatters);

    // The embedded screenshot is the SAME object the package holds (linked by id).
    const linked = pkg.screenshots.find((s) => s.id === pf.screenshotId)!;
    expect(df.screenshot).toBe(linked);
    expect(df.screenshot!.status).toBe("READY");

    // Repair section comes straight from the offer's own customer-facing scope.
    expect(doc.repair.title).toBe(offer.scope.offerName);
    expect(doc.repair.willChange).toEqual(offer.scope.includedItems);
    expect(doc.repair.willNotChange).toEqual(offer.scope.excludedItems);
  });

  it("only embeds a READY screenshot — a finding without one stays text-only (never a placeholder)", async () => {
    mockReadyShots = {}; // no captures at all
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg);
    expect(doc.findings.length).toBe(pkg.findings.length);
    for (const f of doc.findings) expect(f.screenshot).toBeNull();
  });
});

describe("evidence-first, value-before-price ordering (Part Q)", () => {
  it("§1 opener text equals experienceFrame.emailOpener — one evidence truth across email/hero/PDF", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg, "share_tok_123");

    const frame = experienceFrameForOffer(offer);
    // Same SOURCE — the PDF opener is the email opener verbatim, not a re-write.
    expect(doc.opener.opener).toBe(frame.emailOpener);
    expect(doc.opener.heroTitle).toBe(frame.offerHeroTitle);
    expect(doc.opener.friction).toBe(frame.friction);
    expect(doc.opener.attemptSupported).toBe(frame.attemptSupported);
  });

  it("evidence (findings) is assembled before the price section, and price lives only in §FINAL", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg);

    // The document exposes the price ONLY through the isolated §FINAL pricing block.
    expect(doc.pricing.priceLabel).toMatch(/^\$\d+ flat$/);

    // The price string must NOT appear in the cover/opener (§1), any finding (§2),
    // or the scope (§3) — value comes before price, and price is never the headline.
    const price = doc.pricing.priceLabel;
    const beforePrice: string[] = [
      doc.opener.opener,
      doc.opener.heroTitle,
      doc.opener.friction,
      doc.company,
      doc.repair.title,
      doc.repair.solution,
      ...doc.repair.willChange,
      ...doc.repair.willNotChange,
    ];
    for (const f of doc.findings) beforePrice.push(f.observed, f.whyItMatters);
    for (const s of beforePrice) expect(s).not.toContain(price);

    // Findings still carry the real evidence (proof precedes the ask).
    expect(doc.findings.length).toBeGreaterThan(0);
    expect(doc.findings.map((f) => f.id)).toEqual(pkg.findings.map((f) => f.id));
  });

  it("does NOT anchor against a fabricated agency 'value' — no '$X value' string anywhere", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg);
    const all = JSON.stringify(doc).toLowerCase();
    expect(all).not.toMatch(/\$\s*\d[\d,]*\s*value/); // e.g. "$1,200 value"
  });
});

describe("customer-facing filename + email-attachment render API (Part Q)", () => {
  it('filename is "[Business] — Website Review.pdf", sanitized, with NO internal id', () => {
    const offer = gen([CTA]);
    const name = diagnosticPdfFilename(offer);
    expect(name).toBe("Acme Roofing — Website Review.pdf");
    // Never leaks the internal offer/lead id (guard empty ids — offerId is assigned
    // later by the store, so it's "" here; only assert for real, non-empty ids).
    if (offer.offerId) expect(name).not.toContain(offer.offerId);
    if (offer.leadId) expect(name).not.toContain(offer.leadId);
  });

  it("sanitizes to letters/digits/space/&/- and collapses whitespace", () => {
    const offer = { ...gen([CTA]), companyName: "  Bob's  Café & Sons, LLC / #1  " };
    // Apostrophe, é, comma, slash, # stripped; whitespace collapsed; & and - kept.
    expect(diagnosticPdfFilename(offer)).toBe("Bob s Caf & Sons LLC 1 — Website Review.pdf");
  });

  it("falls back to a neutral name when the business sanitizes to nothing", () => {
    const offer = { ...gen([CTA]), companyName: "＠＃＄" };
    expect(diagnosticPdfFilename(offer)).toBe("Website — Website Review.pdf");
  });

  it("renderDiagnosticPdfBuffer(offer) builds the same package and renders a real %PDF buffer", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const offer = gen([CTA]);
    const buf = await renderDiagnosticPdfBuffer(offer);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }, 90_000); // real @react-pdf render is CPU-heavy (~13s solo); allow headroom under full-suite parallel load
});

describe("no assembled customer text contains a fabricated claim", () => {
  it("every observed/whyItMatters/repair string passes the fabrication guard", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg);

    const strings: string[] = [];
    // §1 opener + friction (same source as email/hero) must also be clean.
    strings.push(doc.opener.opener, doc.opener.heroTitle, doc.opener.friction);
    for (const f of doc.findings) strings.push(f.observed, f.whyItMatters);
    strings.push(doc.repair.title, doc.repair.solution);
    strings.push(...doc.repair.willChange, ...doc.repair.willNotChange);
    // §FINAL price block.
    strings.push(doc.pricing.priceLabel, doc.pricing.turnaround);
    for (const s of strings) expect(containsFabricatedClaim(s)).toBe(false);
  });

  it("a finding whose text WOULD be fabricated is DROPPED, not softened", async () => {
    mockReadyShots = {};
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    // Inject a poisoned finding directly onto the package (simulating any upstream
    // finding whose plain text carries a forbidden quantitative claim).
    const poisoned = { ...pkg.findings[0], id: "poison", plain: "Your site is losing $5,000/mo in revenue." };
    expect(containsFabricatedClaim(poisoned.plain)).toBe(true);
    const tainted = { ...pkg, findings: [...pkg.findings, poisoned] };

    const doc = assembleDiagnosticDoc(offer, tainted);
    expect(doc.droppedFindingIds).toContain("poison");
    expect(doc.findings.map((f) => f.id)).not.toContain("poison");
    // The clean finding still survives.
    expect(doc.findings.map((f) => f.id)).toContain(pkg.findings[0].id);
  });
});

describe("evidence-package.diagnosticPdf status tracks renderability", () => {
  it("READY when findings exist, pointing at the offer's diagnostic-pdf route", async () => {
    mockReadyShots = { desktop: readyShot("desktop") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    expect(pkg.findings.length).toBeGreaterThan(0);
    expect(pkg.diagnosticPdf.status).toBe("READY");
    expect(pkg.diagnosticPdf.url).toBe(`/api/quick-fix/${offer.offerId}/diagnostic-pdf`);
  });

  it("MISSING when there are no evidence-backed findings", async () => {
    mockOpportunities = []; // no BI opportunities → no findings
    mockReadyShots = {};
    const offer = gen([]);
    const pkg = await buildEvidencePackage(offer);
    expect(pkg.findings.length).toBe(0);
    expect(pkg.diagnosticPdf.status).toBe("MISSING");
    expect(pkg.diagnosticPdf.url).toBeNull();
  });
});

describe("§20/§21 — the PDF cannot claim screenshots it does not embed", () => {
  // A neutral (non-mobile) finding so we control screenshot presence independently
  // of the mobile-claim guard.
  const NEUTRAL = { id: "cta", category: "Customer Acquisition",
    observation: "the primary button is hard to find", whyItMatters: "visitors can't easily take the next step",
    confidence: { label: "Observed", score: 0.95 }, basis: ["link: https://x"], estimatedImpact: { level: "High" } };

  it("with ZERO embedded screenshots the §2 intro makes NO 'screenshot(s) we captured' claim", async () => {
    mockOpportunities = [NEUTRAL];
    mockReadyShots = {}; // nothing captured → nothing embedded
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg);

    expect(doc.embeddedScreenshotCount).toBe(0);
    // Truthful language: it must not assert a captured screenshot when none is embedded.
    expect(doc.evidenceIntro.toLowerCase()).not.toMatch(/screenshots? we captured/);
    expect(doc.evidenceIntro.toLowerCase()).not.toContain("screenshot");
    // And no finding embeds a shot.
    for (const f of doc.findings) expect(f.screenshot).toBeNull();
  });

  it("with exactly ONE embedded screenshot the intro uses the SINGULAR 'the screenshot we captured'", async () => {
    mockOpportunities = [NEUTRAL];
    mockReadyShots = { desktop: readyShot("desktop") }; // one shot the neutral finding links to
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg);

    expect(doc.embeddedScreenshotCount).toBe(1);
    expect(doc.evidenceIntro).toContain("the screenshot we captured");
    expect(doc.evidenceIntro).not.toContain("screenshots we captured");
  });

  it("with TWO+ embedded screenshots the intro uses the PLURAL 'the screenshots we captured'", async () => {
    // Two neutral findings, each linking to a READY shot → two embedded screenshots.
    mockOpportunities = [
      { ...NEUTRAL, id: "a", observation: "the primary button is hard to find" },
      { ...NEUTRAL, id: "b", observation: "the headline does not explain the offer" },
    ];
    mockReadyShots = { desktop: readyShot("desktop"), mobile: readyShot("mobile") };
    const offer = gen([F({ id: "a" }), F({ id: "b" })]);
    const pkg = await buildEvidencePackage(offer);
    // Force each finding onto a distinct READY viewport so two shots are embedded.
    const twoShotPkg = {
      ...pkg,
      findings: pkg.findings.map((f, i) => ({ ...f, screenshotId: i === 0 ? `${offer.leadId}:desktop` : `${offer.leadId}:mobile` })),
    };
    const doc = assembleDiagnosticDoc(offer, twoShotPkg);

    expect(doc.embeddedScreenshotCount).toBeGreaterThanOrEqual(2);
    expect(doc.evidenceIntro).toContain("the screenshots we captured");
  });

  it("a MOBILE finding with only a DESKTOP shot does NOT print an embedded-screenshot claim (mobile claim demoted to text-only)", async () => {
    // CTA text asserts mobile; only a DESKTOP shot exists → the wrong-viewport shot
    // cannot back a mobile claim, so it is dropped and the finding renders text-only.
    mockReadyShots = { desktop: readyShot("desktop") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg);

    // The unbacked (wrong-viewport) mobile claim is demoted, not asserted.
    expect(doc.unbackedFindingIds).toContain("cta");
    // The finding still SURVIVES as text-only (a text observation makes no screenshot claim).
    const df = doc.findings.find((f) => f.id === "cta")!;
    expect(df).toBeTruthy();
    expect(df.screenshot).toBeNull();
    // No embedded screenshot survives, and the intro claims none.
    expect(doc.embeddedScreenshotCount).toBe(0);
    expect(doc.evidenceIntro.toLowerCase()).not.toContain("screenshot");
  });

  it("a MOBILE finding WITH a mobile shot survives and is backed by the mobile screenshot", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const doc = assembleDiagnosticDoc(offer, pkg);

    expect(doc.unbackedFindingIds).not.toContain("cta");
    const df = doc.findings.find((f) => f.id === "cta")!;
    expect(df).toBeTruthy();
    expect(df.screenshot?.viewport).toBe("mobile");
    expect(doc.embeddedScreenshotCount).toBe(1);
    expect(doc.evidenceIntro).toContain("the screenshot we captured");
  });
});

describe("the full render pipe produces a real PDF", () => {
  it("renders a non-empty %PDF Buffer using the real embedded screenshot bytes", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const buf = await renderDiagnosticPdf(offer, pkg, "share_tok_123");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

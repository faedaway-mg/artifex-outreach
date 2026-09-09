// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE PACKAGE — ONE EVIDENCE TRUTH, MANY PRESENTATIONS.
//
// Proves: a real READY screenshot yields READY (a wrong/missing one yields MISSING,
// never fabricated); the personalized video is ALWAYS MISSING (never the evergreen);
// the customer-receives manifest never shows READY for a missing/stale asset;
// findings.plain restates without adding metrics; a demo job is excluded from sprint
// metrics; and a cta-repair offer's customer-facing name uses the plain customerTitle
// and never leaks the "CTA" acronym.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the read-only external dependencies (repo + screenshot job store) so the
//    builder runs with NO database. Each test seeds the fixtures it needs. ──────────
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

import { buildEvidencePackage, customerReceivesManifest } from "./evidence-package";
import { containsFabricatedClaim } from "./evidence-gate";
import { generateOffer } from "./offer-engine";
import { buildSprintScoreboard, type SprintJob } from "./sprint";
import type { OfferFinding, QuickFixOffer } from "./types";

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});
const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile", category: "Customer Acquisition" });

const gen = (findings: OfferFinding[]) =>
  generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings, generatedAt: "2026-09-01T00:00:00Z" });

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

describe("screenshots are only ever READY when a real stored capture exists", () => {
  it("a real ready screenshot yields status READY with its sha/capturedAt", async () => {
    mockReadyShots = { desktop: readyShot("desktop") };
    const pkg = await buildEvidencePackage(gen([CTA]));
    const desktop = pkg.screenshots.find((s) => s.viewport === "desktop")!;
    expect(desktop.status).toBe("READY");
    expect(desktop.sha256).toBe("abc123");
    expect(desktop.capturedAt).toBe("2026-09-01T10:00:00Z");
    expect(desktop.imageRoute).toContain("business=lead_1");
    expect(pkg.screenshotStatus).toBe("READY");
  });

  it("a missing screenshot yields MISSING and is NEVER fabricated", async () => {
    mockReadyShots = {}; // no captures at all
    const pkg = await buildEvidencePackage(gen([CTA]));
    for (const s of pkg.screenshots) {
      expect(s.status).toBe("MISSING");
      expect(s.sha256).toBeNull();
      expect(s.capturedAt).toBeNull();
    }
    expect(pkg.screenshotStatus).toBe("MISSING");
  });
});

describe("personalized video is ALWAYS MISSING (never the evergreen)", () => {
  it("personalizedVideo is MISSING with null url even when the evergreen is present", async () => {
    mockReadyShots = { desktop: readyShot("desktop") };
    const pkg = await buildEvidencePackage(gen([CTA]));
    expect(pkg.personalizedVideo.status).toBe("MISSING");
    expect(pkg.personalizedVideo.url).toBeNull();
    // The evergreen video is a SEPARATE ref and must NOT be substituted in.
    expect(pkg.evergreenVideo.status).toBe("READY");
    expect(pkg.evergreenVideo.url).not.toBeNull();
    expect(pkg.personalizedVideo.url).not.toBe(pkg.evergreenVideo.url);
  });
});

describe("customerReceivesManifest never shows READY for a missing/stale asset", () => {
  it("missing screenshot / personalized video / email are never shown READY (the PDF renders from findings)", async () => {
    mockReadyShots = {}; // screenshots missing
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    const manifest = customerReceivesManifest(pkg, offer, /*emailReady*/ false);
    const row = (k: string) => manifest.find((r) => r.key === k)!;
    expect(row("screenshots").status).toBe("MISSING");
    // The diagnostic PDF is renderable on-demand from the canonical findings (a real,
    // evidence-backed asset) — it does NOT depend on screenshots, so it is legitimately
    // READY here. It is READY from findings, never from SKU capability alone.
    expect(row("diagnosticPdf").status).toBe("READY");
    expect(pkg.findings.length).toBeGreaterThan(0);
    expect(row("personalizedVideo").status).toBe("MISSING");
    expect(row("email").status).toBe("MISSING");
    // No row may claim READY when its underlying asset is genuinely not ready.
    for (const r of manifest) {
      // findings, evergreen video, and the from-findings diagnostic PDF are legitimately READY
      if (r.key === "findings" || r.key === "evergreenVideo" || r.key === "diagnosticPdf") continue;
      expect(r.status).not.toBe("READY");
    }
  });

  it("the manifest mirrors the exact asset status — a stale asset stays non-READY", async () => {
    mockReadyShots = { desktop: readyShot("desktop") };
    const offer = gen([CTA]);
    const pkg = await buildEvidencePackage(offer);
    // Force the screenshot roll-up to a non-READY state (simulate stale) and confirm
    // the manifest reflects it rather than optimistically upgrading.
    const stale = { ...pkg, screenshotStatus: "STALE" as const };
    const manifest = customerReceivesManifest(stale, offer, true);
    expect(manifest.find((r) => r.key === "screenshots")!.status).toBe("STALE");
  });
});

describe("findings.plain restates without inventing facts", () => {
  it("plain text passes the fabrication guard (no metrics/outcomes added)", async () => {
    mockReadyShots = { mobile: readyShot("mobile") };
    const pkg = await buildEvidencePackage(gen([CTA]));
    expect(pkg.findings.length).toBeGreaterThan(0);
    for (const f of pkg.findings) {
      expect(f.plain.length).toBeGreaterThan(0);
      expect(containsFabricatedClaim(f.plain)).toBe(false);
      // A mobile finding links to the mobile screenshot when one is ready.
      expect(f.screenshotId).toBe("lead_1:mobile");
    }
  });
});

describe("demo jobs are HARD-excluded from the sprint scoreboard", () => {
  it("a demo COMPLETE job never counts toward completedJobs or gross revenue", () => {
    const real: SprintJob = { offerId: "real", state: "COMPLETE", priceCents: 24900, skuFamily: "cta", hasCompletionEvidence: true };
    const demo: SprintJob = { offerId: "demo", state: "COMPLETE", priceCents: 999900, skuFamily: "cta", hasCompletionEvidence: true, isDemo: true };
    const withDemo = buildSprintScoreboard([real, demo], []);
    const withoutDemo = buildSprintScoreboard([real], []);
    expect(withDemo.completedJobs).toBe(1);
    expect(withDemo.grossRevenueCents).toBe(24900);
    expect(withDemo.completedJobs).toBe(withoutDemo.completedJobs);
    expect(withDemo.grossRevenueCents).toBe(withoutDemo.grossRevenueCents);
    expect(withDemo.capabilityProofs).toBe(1); // demo proof excluded
  });
});

describe("customer-facing offer name uses the plain customerTitle (no acronym leak)", () => {
  it("a cta-repair offer name does NOT contain 'CTA' and uses the plain title", () => {
    const offer = gen([CTA]);
    expect(offer.capabilityKeys).toContain("cta-repair");
    expect(offer.scope.offerName).not.toMatch(/\bCTA\b/);
    expect(offer.scope.offerName).toContain("Booking & Contact Button Repair");
  });
});

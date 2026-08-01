import { describe, it, expect, beforeEach } from "vitest";
import { signToken, verifyToken } from "./auth-token";
import { assertAuthConfigured } from "./auth-config";
import { rateLimit, resetRateLimit } from "./ratelimit";
import { uploadPdf, storageProvider } from "./storage";
import { discoverInputSchema } from "./schemas";
import { analyzeWebsite } from "./providers/website";
import type { Lead } from "./types";

function bareLead(p: Partial<Lead>): Lead {
  return {
    id: "l1", googlePlaceId: null, businessName: "X", normalizedName: "x", industry: "Law firm", normalizedCategory: "law-firms", categoryGroup: "Professional Services",
    address: "", city: "", state: "", postalCode: "", latitude: null, longitude: null, phone: null,
    website: null, websiteDomain: null, publicEmail: null, contactFormUrl: null, socialLinks: [],
    locationsCount: null, rating: null, reviewCount: null, businessStatus: "OPERATIONAL", googleMapsUrl: null,
    hours: null, source: "test", retrievedAt: null, tier: null, leadScore: null, scoreBreakdown: null,
    pipelineStage: "Discovered", estimatedValueLow: null, estimatedValueHigh: null, recommendedService: null,
    recommendedAction: null, recommendationReason: null, opportunitySummary: null, strengths: [],
    acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, createdAt: "", updatedAt: "", ...p,
  };
}

describe("session tokens", () => {
  it("round-trips a valid token", () => {
    expect(verifyToken(signToken("jordan"))).toBe(true);
  });
  it("rejects a tampered token", () => {
    const t = signToken("jordan");
    expect(verifyToken(t.slice(0, -2) + "xy")).toBe(false);
  });
  it("rejects garbage and empty", () => {
    expect(verifyToken(undefined)).toBe(false);
    expect(verifyToken("not.a.token")).toBe(false);
  });
});

describe("production auth guard", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    (process.env as any).NODE_ENV = orig.NODE_ENV;
    process.env.OUTREACH_PASSWORD = orig.OUTREACH_PASSWORD;
    process.env.AUTH_SECRET = orig.AUTH_SECRET;
  });
  it("passes in non-production", () => {
    (process.env as any).NODE_ENV = "test";
    expect(() => assertAuthConfigured()).not.toThrow();
  });
  it("throws in production with default/missing secrets", () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.OUTREACH_PASSWORD;
    delete process.env.AUTH_SECRET;
    expect(() => assertAuthConfigured()).toThrow(/insecure production auth/);
    (process.env as any).NODE_ENV = "test";
  });
  it("passes in production with strong secrets", () => {
    (process.env as any).NODE_ENV = "production";
    process.env.OUTREACH_PASSWORD = "a-strong-password";
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    expect(() => assertAuthConfigured()).not.toThrow();
    (process.env as any).NODE_ENV = "test";
  });
});

describe("login rate limiting", () => {
  it("blocks after the limit within the window", () => {
    resetRateLimit("k");
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000).allowed).toBe(true);
    expect(rateLimit("k", 3, 60_000).allowed).toBe(false);
  });
});

describe("storage adapter", () => {
  it("defaults to mock without S3 credentials", () => {
    expect(storageProvider()).toBe("mock");
  });
  it("produces predictable lead-scoped PDF keys", async () => {
    const r = await uploadPdf("lead_123", "deliv_9", Buffer.from("%PDF-1.3"));
    expect(r.key).toBe("leads/lead_123/deliverables/deliv_9.pdf");
  });
});

describe("places input validation", () => {
  it("requires a category", () => {
    expect(discoverInputSchema.safeParse({}).success).toBe(false);
    expect(discoverInputSchema.safeParse({ category: "Dental practice" }).success).toBe(true);
  });
});

describe("website analysis", () => {
  it("flags a missing website as a verified fact (deterministic)", async () => {
    const a = await analyzeWebsite(bareLead({ website: null }));
    expect(a.performedWith).toBe("mock");
    expect(a.findings[0].findingType).toBe("Verified fact");
    expect(a.signals.hasWebsite).toBe(false);
  });
});

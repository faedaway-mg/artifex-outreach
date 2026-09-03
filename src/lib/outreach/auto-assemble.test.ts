// Focused tests (mandate §4): auto-assembly is idempotent per render input version, fails closed without a
// verified video, and a NEWER render is not treated as the same package.
import { describe, it, expect, beforeEach } from "vitest";
import { autoAssembleFromRender } from "./prospect-package-store";
import { insertLead, appendAudit } from "../repo";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const PKG_ACTION = "prospect.package";
async function seedLead(): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Canary Co", normalizedName: "canaryco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://c.example", websiteDomain: "c.example",
    publicEmail: "hello@artifexlabs.tech", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "internal-test", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}

beforeEach(() => { __resetStoreForTests(); });

describe("autoAssembleFromRender — idempotent post-render assembly", () => {
  it("fails closed when no verified video exists", async () => {
    const lead = await seedLead();
    const r = await autoAssembleFromRender(lead.id, { loadVideo: async () => null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/video not ready/i);
  });

  it("is a no-op when a package is already bound to THIS render input version", async () => {
    const lead = await seedLead();
    // Pre-seed a READY_TO_APPROVE package bound to input version v1.
    await appendAudit({ action: PKG_ACTION, actor: "system-auto", targetType: "lead", targetId: lead.id, meta: { pkg: { leadId: lead.id, packageVersion: 1, state: "READY_TO_APPROVE", packageDigest: "d1", video: { inputVersion: "v1", jobId: "j1", videoKey: "k1", sha256: "s1" }, share: { publicId: "pub_x", shareVersion: 1, keyVersion: 1 } } } as any, ip: null });
    const r = await autoAssembleFromRender(lead.id, { loadVideo: async () => ({ jobId: "j1", inputVersion: "v1", videoKey: "k1", sha256: "s1" }) });
    expect(r.ok).toBe(true);
    expect(r.idempotent).toBe(true);
    expect(r.packageVersion).toBe(1);
  });

  it("a NEWER render (different input version) is not treated as idempotent", async () => {
    const lead = await seedLead();
    await appendAudit({ action: PKG_ACTION, actor: "system-auto", targetType: "lead", targetId: lead.id, meta: { pkg: { leadId: lead.id, packageVersion: 1, state: "FROZEN", packageDigest: "d1", video: { inputVersion: "v1", jobId: "j1", videoKey: "k1", sha256: "s1" }, share: { publicId: "pub_x", shareVersion: 1, keyVersion: 1 } } } as any, ip: null });
    const r = await autoAssembleFromRender(lead.id, { loadVideo: async () => ({ jobId: "j2", inputVersion: "v2", videoKey: "k2", sha256: "s2" }) });
    // Not the same version → NOT idempotent (it attempts a fresh assembly; success depends on evidence).
    expect(r.idempotent).not.toBe(true);
  });
});

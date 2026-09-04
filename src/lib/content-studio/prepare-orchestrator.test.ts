// Focused test: the orchestrator skips unqualified/committed/internal leads and never weakens gates.
import { describe, it, expect, beforeEach } from "vitest";
import { prepareProspectVideoCandidates } from "./prepare-orchestrator";
import { insertLead } from "../repo";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

async function seed(over: Partial<Lead>): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Co", normalizedName: "co", industry: "Auto repair", normalizedCategory: "auto-repair",
    categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012", latitude: null, longitude: null,
    phone: "(213) 555-0100", website: "https://x.example", websiteDomain: "x.example", publicEmail: "info@x.example",
    contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20, businessStatus: "OPERATIONAL",
    googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 70, scoreBreakdown: {} as any,
    pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000, recommendedService: "x", recommendedAction: "x",
    recommendationReason: null, opportunitySummary: "x", strengths: [], acquisitionStrategy: "Assisted", acquisitionScore: 60,
    acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: "jordan", assignedAt: null,
    assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
  } as any);
}

beforeEach(() => { __resetStoreForTests(); });

describe("prepareProspectVideoCandidates — gating (never weakens evidence)", () => {
  it("skips no-website, no-recipient, terminal, and no-stored-evidence leads", async () => {
    await seed({ businessName: "NoSite", website: null });
    await seed({ businessName: "NoEmail", publicEmail: null });
    await seed({ businessName: "Terminal", pipelineStage: "Disqualified" });
    await seed({ businessName: "NoEvidence" }); // has site+email but NO stored BI profile
    const r = await prepareProspectVideoCandidates({ max: 20 });
    expect(r.prepared.length).toBe(0); // none qualify without stored evidence — gate holds
    // Whole-book runs now route structural exclusions through the CANONICAL eligibility selector,
    // so the skip key is "ineligible:<reason>" (contacted/scheduled likewise excluded here).
    expect(r.skipped["ineligible:no-website"]).toBeGreaterThanOrEqual(1);
    expect(r.skipped["ineligible:no-recipient"]).toBeGreaterThanOrEqual(1);
    expect(r.skipped["ineligible:terminal-stage"]).toBeGreaterThanOrEqual(1);
    expect(r.skipped["no-stored-evidence"]).toBeGreaterThanOrEqual(1);
  });
});

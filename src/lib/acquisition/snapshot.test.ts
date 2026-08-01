import { describe, it, expect } from "vitest";
import { buildApprovalSnapshot } from "./snapshot";
import type { Lead, Finding, Deliverable, ConceptPreview, Video, ScoreBreakdown } from "../types";

function lead(p: Partial<Lead>): Lead {
  return {
    id: "l1", googlePlaceId: null, businessName: "Acme Dental Group", normalizedName: "acmedental", industry: "Dental practice",
    normalizedCategory: "dental-practices", categoryGroup: "Health and Wellness", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://acme.example", websiteDomain: "acme.example",
    publicEmail: "hello@acme.example", contactFormUrl: "https://acme.example/contact", socialLinks: [], locationsCount: 2, rating: 4.8, reviewCount: 214,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "A", leadScore: 82,
    scoreBreakdown: { businessFit: 18, websiteOpportunity: 18, automationOpportunity: 16, abilityToPay: 13, publicReputation: 9, contactability: 9, triggerUrgency: 3 } as ScoreBreakdown,
    pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "Business Website System",
    recommendedAction: "Prepare video", recommendationReason: null, opportunitySummary: "great fit", strengths: [],
    acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, createdAt: "", updatedAt: "", ...p,
  };
}
const finding = (p: Partial<Finding>): Finding => ({ id: "f1", leadId: "l1", category: "Design", title: "Outdated homepage", observation: "", evidence: "", businessImpact: "", modernizationDirection: "", findingType: "AI inference", confidence: "Likely", sourceUrl: null, analyzedAt: null, deterministic: true, approved: true, createdAt: "", updatedAt: "", ...p });

const emptyRecords = { findings: [] as Finding[], deliverables: [] as Deliverable[], previews: [] as ConceptPreview[], videos: [] as Video[], contacts: 0 };

describe("buildApprovalSnapshot", () => {
  it("captures the live decision context for an Assisted plan", () => {
    const snap = buildApprovalSnapshot(lead({}), { strategy: "Assisted", ...emptyRecords, contacts: 1 });
    expect(snap.estimatedValueSnapshot).toBe("$8,000–$18,000");
    expect(snap.contactConfidenceSnapshot).toBe("high");
    // No brief/concept present → Assisted requires both, so not ready and both missing.
    expect(snap.assetReadinessSnapshot).toBe(false);
    expect(snap.assetMissingSnapshot).toEqual(["Modernization Brief", "Concept Website"]);
    expect(snap.websiteHealthSnapshot).toBe("Website present — not yet analyzed.");
  });

  it("stores null estimated value when both bounds are unset", () => {
    const snap = buildApprovalSnapshot(lead({ estimatedValueLow: null, estimatedValueHigh: null }), { strategy: "Light", ...emptyRecords });
    expect(snap.estimatedValueSnapshot).toBeNull();
    // Light only needs a message (always generated) → ready, nothing missing.
    expect(snap.assetReadinessSnapshot).toBe(true);
    expect(snap.assetMissingSnapshot).toEqual([]);
  });

  it("is a pure snapshot — recomputing after the lead changes yields a different result, proving the frozen value must be stored", () => {
    const l = lead({ estimatedValueLow: 5000, estimatedValueHigh: 9000 });
    const before = buildApprovalSnapshot(l, { strategy: "Assisted", ...emptyRecords });
    const after = buildApprovalSnapshot({ ...l, estimatedValueLow: 50000, estimatedValueHigh: 90000 }, { strategy: "Assisted", ...emptyRecords });
    expect(before.estimatedValueSnapshot).toBe("$5,000–$9,000");
    expect(after.estimatedValueSnapshot).toBe("$50,000–$90,000");
    // The engine persists `before` at approval time; a later lead edit does not
    // retroactively change it because the value lives on the plan record.
    expect(before.estimatedValueSnapshot).not.toBe(after.estimatedValueSnapshot);
  });

  it("summarizes website health from approved findings", () => {
    const snap = buildApprovalSnapshot(lead({}), { strategy: "Assisted", ...emptyRecords, findings: [finding({ category: "Design" }), finding({ id: "f2", category: "SEO" })] });
    expect(snap.websiteHealthSnapshot).toBe("2 finding(s): Design, SEO.");
  });
});

import { describe, it, expect } from "vitest";
import type { Lead } from "../types";
import { buildLeadSprintReport, sprintCandidateFromLead, type LeadSprintContext } from "./read-model";

// Minimal Lead fixture — only the fields the scorers read; the rest are null/defaults.
function lead(over: Partial<Lead> & { id: string }): Lead {
  return {
    googlePlaceId: null,
    businessName: over.businessName ?? "Test Biz",
    normalizedName: (over.businessName ?? "test biz").toLowerCase(),
    industry: over.industry ?? "Dental practice",
    normalizedCategory: null, categoryGroup: null,
    address: "1 Main St", city: over.city ?? "Greenville", state: over.state ?? "SC", postalCode: "29601",
    latitude: null, longitude: null,
    phone: over.phone ?? "864-555-0100", website: over.website ?? "https://example.com", websiteDomain: "example.com",
    publicEmail: over.publicEmail ?? "owner@example.com", contactFormUrl: null, socialLinks: [],
    locationsCount: over.locationsCount ?? 1, rating: over.rating ?? 4.7, reviewCount: over.reviewCount ?? 180,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: over.source ?? "google-places",
    retrievedAt: null, tier: null, leadScore: null, scoreBreakdown: null,
    pipelineStage: over.pipelineStage ?? "Discovered",
    estimatedValueLow: null, estimatedValueHigh: null, recommendedService: null, recommendedAction: null,
    recommendationReason: null, opportunitySummary: null, strengths: [], acquisitionStrategy: null,
    acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: null, assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null,
    note: null, lastContactAt: null, nextFollowUpAt: null, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

// A fully package-ready pod finalist: strong reputation, specific evidence, reachable owner, clean offer.
function finalistCtx(id: string, over: Partial<Lead> = {}): LeadSprintContext {
  return {
    lead: lead({ id, ...over }),
    findings: [
      { id: `f_${id}`, observation: "No mobile booking; contact form broken on mobile", whyItMatters: "Loses after-hours patients", confidenceScore: 0.8 },
    ],
    contact: { name: "Dr. Owner", title: "Owner", email: "owner@example.com", verified: true, role: "owner" } as any,
    isSuppressed: false,
    isDuplicate: false,
    quickFixEligible: true,
    clearsMarginGate: true,
    voiceGenerationResolved: true,
    compatibleTrustAvailable: true,
  };
}

// A raw discovered lead: no findings/contact/offer yet → pool member, NOT a finalist.
function rawCtx(id: string, over: Partial<Lead> = {}): LeadSprintContext {
  return {
    lead: lead({ id, ...over }),
    findings: [],
    contact: null,
    isSuppressed: false,
    isDuplicate: false,
    quickFixEligible: false,
    clearsMarginGate: false,
    voiceGenerationResolved: true,
    compatibleTrustAvailable: false,
  };
}

describe("lead sprint read-model (#183 on real leads)", () => {
  it("a package-ready pod lead scores, pools, and becomes a finalist", () => {
    const c = sprintCandidateFromLead(finalistCtx("L1"));
    expect(c.podId).toBe("greenville-sc");
    expect(c.podPriority).toBe("priority");
    expect(c.sendValue.total).toBeGreaterThan(0);
    expect(c.productionConfidence.meetsMinimumContract).toBe(true);
    expect(c.cheaplyQualified).toBe(true);
  });

  it("a raw discovered lead pools but is NOT a finalist (no constructible package)", () => {
    const c = sprintCandidateFromLead(rawCtx("L2"));
    expect(c.productionConfidence.meetsMinimumContract).toBe(false); // no offer/evidence/contact
  });

  it("builds a report: broad pool, few finalists, suppressed excluded", () => {
    const report = buildLeadSprintReport(
      [
        finalistCtx("A", { businessName: "Greenville Dental", city: "Greenville", state: "SC" }),
        finalistCtx("B", { businessName: "Huntsville Law", city: "Huntsville", state: "AL", industry: "Law firm" }),
        rawCtx("C", { businessName: "Chattanooga Cafe", city: "Chattanooga", state: "TN" }),
        { ...finalistCtx("D"), isSuppressed: true },
      ],
      { nearTermCapacity: 4 },
    );
    expect(report.suppressed).toBe(1);                 // D excluded, audited
    expect(report.rankedPool).toBe(3);                 // A, B, C
    expect(report.finalists.length).toBe(2);           // only A, B have packages
    expect(report.finalists.every((f) => f.leadId !== "C" && f.leadId !== "D")).toBe(true);
    expect(report.marketDistribution.length).toBeGreaterThan(0);
  });

  it("podsOnly restricts to the four initial pods", () => {
    const report = buildLeadSprintReport(
      [finalistCtx("A", { city: "Greenville", state: "SC" }), finalistCtx("X", { city: "Portland", state: "OR" })],
      { nearTermCapacity: 4, podsOnly: true },
    );
    expect(report.discovered).toBe(1); // Portland filtered out
    expect(report.pool[0].leadId).toBe("A");
  });
});

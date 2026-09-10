import { describe, it, expect } from "vitest";
import { classifyLead, isActiveLead, partitionLeadsByActivity, leadLegacyInput } from "./legacy-active";
import { buildLeadSprintReport, type LeadSprintContext } from "./read-model";
import type { Lead } from "../types";

// Minimal Lead factory — only the fields the classifier + scorers read matter.
function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: over.id ?? "lead_1",
    googlePlaceId: null,
    businessName: over.businessName ?? "Greenville Dental",
    normalizedName: "greenville dental",
    industry: over.industry ?? "Dentist",
    normalizedCategory: null,
    categoryGroup: null,
    address: "1 Main St",
    city: over.city ?? "Greenville",
    state: over.state ?? "SC",
    postalCode: "29601",
    latitude: null, longitude: null,
    phone: over.phone ?? "864-555-0100",
    website: over.website ?? "https://greenvilledental.example",
    websiteDomain: "greenvilledental.example",
    publicEmail: over.publicEmail ?? "hi@greenvilledental.example",
    contactFormUrl: null, socialLinks: [],
    locationsCount: over.locationsCount ?? 1,
    rating: 4.6, reviewCount: 120,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null,
    source: over.source ?? "google-places",
    retrievedAt: null, tier: null, leadScore: null, scoreBreakdown: null,
    pipelineStage: over.pipelineStage ?? "New",
    estimatedValueLow: null, estimatedValueHigh: null,
    recommendedService: null, recommendedAction: null, recommendationReason: null,
    opportunitySummary: null, strengths: [], acquisitionStrategy: null,
    acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null,
    acquisitionOverride: false, assignedTo: null, assignedAt: null, assignmentReason: null,
    lastOperatorActivityAt: null, note: over.note ?? null, lastContactAt: null, nextFollowUpAt: null,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as Lead;
}

describe("legacy active-view exclusion (§4 / #203)", () => {
  it("a real owner-led local business stays ACTIVE", () => {
    expect(isActiveLead(lead())).toBe(true);
    expect(classifyLead(lead()).disposition).toBe("active");
  });

  it("a synthetic/test-provenance record is LEGACY_ARCHIVED", () => {
    const c = classifyLead(lead({ id: "seed_1", source: "seed-fixture" }));
    expect(c.disposition).toBe("LEGACY_ARCHIVED");
    expect(isActiveLead(lead({ source: "synthetic-demo" }))).toBe(false);
  });

  it("a national enterprise (many locations) is DISQUALIFIED_LEGACY — Liberty Tax-scale falls out of the general rule", () => {
    const c = classifyLead(lead({ businessName: "Liberty Tax", locationsCount: 2000, industry: "Tax Preparation" }));
    expect(c.disposition).toBe("DISQUALIFIED_LEGACY");
    expect(c.requalifiable).toBe(false);
  });

  it("a multi-location corporate franchise is DISQUALIFIED_LEGACY — Motion Recruitment-scale falls out of the general rule", () => {
    const c = classifyLead(lead({ businessName: "Motion Recruitment", locationsCount: 20, industry: "Staffing" }));
    expect(c.disposition).toBe("DISQUALIFIED_LEGACY");
  });

  it("a pipeline-Rejected/Disqualified lead does not meet current ICP fit", () => {
    expect(leadLegacyInput(lead({ pipelineStage: "Rejected" })).meetsCurrentIcpFit).toBe(false);
    expect(classifyLead(lead({ pipelineStage: "Disqualified" })).disposition).toBe("DISQUALIFIED_LEGACY");
  });

  it("a prospect-video demo artifact is LEGACY_ARCHIVED (historical, not active)", () => {
    expect(classifyLead(lead({ source: "prospect-video-demo" })).disposition).toBe("LEGACY_ARCHIVED");
  });

  it("partitions leads into active / archived / disqualified, keeping every classification", () => {
    const leads = [
      lead({ id: "a", businessName: "Real Local" }),
      lead({ id: "b", source: "seed" }),
      lead({ id: "c", locationsCount: 500 }),
    ];
    const p = partitionLeadsByActivity(leads);
    expect(p.active.map((l) => l.id)).toEqual(["a"]);
    expect(p.archived.map((l) => l.id)).toEqual(["b"]);
    expect(p.disqualified.map((l) => l.id)).toEqual(["c"]);
    expect(Object.keys(p.classifications)).toHaveLength(3);
  });
});

describe("legacy exclusion is wired into the Lead Sprint read-model (never reaches active pool/finalists)", () => {
  function ctx(l: Lead): LeadSprintContext {
    return {
      lead: l, findings: [], contact: null, isSuppressed: false, isDuplicate: false,
      quickFixEligible: false, clearsMarginGate: false, voiceGenerationResolved: true,
      compatibleTrustAvailable: false,
    };
  }

  it("archived/disqualified leads are excluded from the active pool and counted, real leads remain", () => {
    const contexts = [
      ctx(lead({ id: "real-1", businessName: "Greenville Dental", city: "Greenville", state: "SC" })),
      ctx(lead({ id: "test-1", source: "fixture", city: "Greenville", state: "SC" })),
      ctx(lead({ id: "ent-1", locationsCount: 300, city: "Greenville", state: "SC" })),
    ];
    const report = buildLeadSprintReport(contexts, { nearTermCapacity: 4, podsOnly: true });
    expect(report.excludedLegacy).toBe(2);
    expect(report.excludedLegacyArchived).toBe(1);       // the fixture record
    expect(report.excludedLegacyDisqualified).toBe(1);   // the enterprise record
    // only the real lead reaches the pool — legacy records never appear
    expect(report.pool.map((c) => c.leadId)).toEqual(["real-1"]);
    expect(report.finalists.every((f) => f.leadId !== "test-1" && f.leadId !== "ent-1")).toBe(true);
  });
});

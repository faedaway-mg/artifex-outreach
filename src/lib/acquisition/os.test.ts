import { describe, it, expect } from "vitest";
import { explainStrategy, computeAcquisitionStrategy } from "./strategy";
import { requiredAssetsFor, assetReadiness } from "./assets";
import { collectTimeline } from "./timeline";
import { contactConfidence, websiteHealthSummary, riskFlags } from "./summary";
import { getEmailProvider, disabledEmailProvider } from "../comms/provider";
import { acquisitionMetrics } from "./analytics";
import type { Lead, Finding, AcquisitionPlan } from "../types";

function lead(p: Partial<Lead>): Lead {
  return {
    id: "l1", googlePlaceId: null, businessName: "Acme", normalizedName: "acme", industry: "Dental practice",
    normalizedCategory: "dental-practices", categoryGroup: "Health and Wellness", address: "1", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://a.example", websiteDomain: "a.example", publicEmail: "hi@a.example",
    contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 100, businessStatus: "OPERATIONAL", googleMapsUrl: null,
    hours: null, source: "test", retrievedAt: null, tier: "A", leadScore: 70, scoreBreakdown: null, pipelineStage: "Qualified",
    estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "Business Website System", recommendedAction: null, recommendationReason: null,
    opportunitySummary: null, strengths: [], acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null,
    acquisitionOverride: false, assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null, createdAt: "2026-07-01T10:00:00Z", updatedAt: "2026-07-10T10:00:00Z", ...p,
  };
}

describe("explainability", () => {
  it("produces a human-readable explanation per strategy", () => {
    const r = computeAcquisitionStrategy(lead({ locationsCount: 2 }), { hasApprovedFindings: true });
    const text = explainStrategy(r.strategy, r.breakdown, lead({}));
    expect(text).toMatch(/received|Nurture|Manual Review|do not contact/i);
    expect(text.toLowerCase()).toContain("rating");
    expect(text.length).toBeGreaterThan(40);
  });
});

describe("asset pipeline", () => {
  it("Personal requires brief+concept+video+research", () => {
    expect(requiredAssetsFor("Personal").sort()).toEqual(["brief", "concept", "research", "video"]);
  });
  it("Light needs only the message (always ready)", () => {
    expect(assetReadiness("Light", {}).ready).toBe(true);
  });
  it("detects missing assets", () => {
    const r = assetReadiness("Personal", { brief: true, concept: false, video: false, research: true });
    expect(r.ready).toBe(false);
    expect(r.missing.sort()).toEqual(["concept", "video"]);
  });
});

describe("timeline", () => {
  it("collects and sorts events chronologically", () => {
    const t = collectTimeline({ lead: lead({}), findings: [], deliverables: [], videos: [], shares: [], meetings: [{ id: "m", leadId: "l1", contactId: null, scheduledAt: "2026-07-05T10:00:00Z", meetingUrl: null, discoveryQuestions: [], likelyObjections: [], notes: "", nextStep: "", outcome: "pending", createdAt: "", updatedAt: "" }], proposals: [], plans: [], outreach: [], inbound: [] });
    expect(t[0].kind).toBe("discovered");
    expect(t.some((e) => e.kind === "meeting")).toBe(true);
    for (let i = 1; i < t.length; i++) expect(+new Date(t[i].at)).toBeGreaterThanOrEqual(+new Date(t[i - 1].at));
  });
});

describe("summary helpers", () => {
  it("contact confidence reflects available routes", () => {
    expect(contactConfidence(lead({})).level).toBe("high");
    expect(contactConfidence(lead({ publicEmail: null, phone: null, website: null, contactFormUrl: null })).level).toBe("low");
  });
  it("website health flags no-website + findings", () => {
    expect(websiteHealthSummary(lead({ website: null }), [])).toMatch(/no website/i);
  });
  it("risk flags catch suppression + regulated + no email", () => {
    const f = riskFlags(lead({ publicEmail: null }), true);
    expect(f.join(" ")).toMatch(/Suppressed/);
    expect(f.join(" ")).toMatch(/No public email/);
    expect(f.join(" ")).toMatch(/Regulated/);
  });
});

describe("comms abstraction", () => {
  it("default provider cannot send (sending disabled)", async () => {
    const p = getEmailProvider();
    expect(p).toBe(disabledEmailProvider);
    expect(p.canSend).toBe(false);
    const r = await p.send({ to: "x@y.com", from: "a@b.com", subject: "s", text: "t", idempotencyKey: "k" });
    expect(r.sent).toBe(false);
    expect((await p.verifyConfiguration()).ok).toBe(false);
  });
});

describe("acquisition analytics", () => {
  it("computes approval rate + distribution", () => {
    const plan = (over: Partial<AcquisitionPlan>): AcquisitionPlan => ({ id: "p", leadId: "l1", strategy: "Assisted", objective: "", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null, status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null, approvedBy: "jordan", approvedAt: "2026-07-02T10:00:00Z", startedAt: null, pausedAt: null, completedAt: null, pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null, assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan", createdAt: "2026-07-02T08:00:00Z", updatedAt: "", ...over });
    const m = acquisitionMetrics([lead({ acquisitionStrategy: "Assisted" })], [plan({}), plan({ id: "p2", approvalStatus: "rejected" })], [], [], [], []);
    expect(m.approvedPlans).toBe(1);
    expect(m.approvalRate).toBe(50);
    expect(m.avgTimeToApprovalHours).toBe(2);
    expect(m.strategyDistribution[0][0]).toBe("Assisted");
  });
});

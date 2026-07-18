import { describe, it, expect } from "vitest";
import { computeAcquisitionStrategy } from "./strategy";
import { POLICIES, policyFor } from "./policy";
import { buildSequence } from "./sequences";
import { checkPlanCompliance } from "./compliance";
import { defaultSettings } from "../store";
import type { Lead, AcquisitionPlan, AcquisitionStep, ScoreBreakdown } from "../types";

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
    assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null, createdAt: "", updatedAt: "", ...p,
  };
}
const settings = () => defaultSettings();
function planFor(strategy: any): AcquisitionPlan {
  const p = policyFor(strategy);
  return { id: "p1", leadId: "l1", strategy, objective: p.objective, assetPackage: p.assetPackage, primaryChannel: p.primaryChannel, secondaryChannel: p.secondaryChannel, status: "prepared", approvalStatus: "pending", currentStep: 0, maxTouches: p.maxTouches, nextScheduledAt: null, replyState: null, approvedBy: null, approvedAt: null, startedAt: null, pausedAt: null, completedAt: null, pauseReason: null, stopReason: null, estimatedCost: p.estimatedCost, estimatedValueSnapshot: null, assetReadinessSnapshot: null, assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan", createdAt: "", updatedAt: "" };
}
function stepsFrom(strategy: any, l: Lead, s = settings()): AcquisitionStep[] {
  return buildSequence(strategy, l, s, "one clear opportunity.").map((d, i) => ({ id: "s" + i, planId: "p1", stepNumber: d.stepNumber, channel: d.channel, delayDays: d.delayDays, subject: d.subject, content: d.content, approvalRequired: d.approvalRequired, approvalStatus: "pending", scheduledAt: null, sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null, createdAt: "" }));
}

describe("strategy engine", () => {
  it("#1 high-value, contactable, regulated, multi-location → Personal", () => {
    expect(computeAcquisitionStrategy(lead({}), { hasApprovedFindings: true }).strategy).toBe("Personal");
  });
  it("#2 rating alone does not determine automation", () => {
    // Low rating but strong opportunity/contact → still high treatment (not forced down)
    const lowRating = computeAcquisitionStrategy(lead({ rating: 2.4, reviewCount: 30 }), { hasApprovedFindings: true });
    expect(["Personal", "Assisted"]).toContain(lowRating.strategy);
    // High rating but tiny opportunity + minimal need → NOT Personal
    const highRatingLowOpp = computeAcquisitionStrategy(lead({ rating: 5.0, estimatedValueLow: 0, estimatedValueHigh: 0, locationsCount: 1, scoreBreakdown: { businessFit: 6, websiteOpportunity: 4, automationOpportunity: 3, abilityToPay: 4, publicReputation: 10, contactability: 6, triggerUrgency: 1 } as ScoreBreakdown }));
    expect(highRatingLowOpp.strategy).not.toBe("Personal");
    // Rating contributes at most ~7 to trustStability (never a majority of the score)
    expect(highRatingLowOpp.breakdown.trustStability).toBeLessThanOrEqual(15);
  });
  it("#14 suppressed / closed → Do Not Contact", () => {
    expect(computeAcquisitionStrategy(lead({}), { suppressed: true }).strategy).toBe("Do Not Contact");
    expect(computeAcquisitionStrategy(lead({ businessStatus: "CLOSED_PERMANENTLY" })).strategy).toBe("Do Not Contact");
  });
  it("no reliable contact → Manual Review", () => {
    expect(computeAcquisitionStrategy(lead({ phone: null, publicEmail: null, website: null, contactFormUrl: null })).strategy).toBe("Manual Review");
  });
});

describe("policy limits", () => {
  it("#3/#12/#23 Personal requires individual approval (never batch)", () => {
    expect(POLICIES.Personal.requiresIndividualApproval).toBe(true);
    expect(POLICIES.Personal.batchApprovable).toBe(false);
  });
  it("#4 Assisted is batch-approvable", () => {
    expect(POLICIES.Assisted.batchApprovable).toBe(true);
    expect(POLICIES.Assisted.requiresIndividualApproval).toBe(false);
  });
  it("#5 Light uses no paid assets", () => {
    const p = POLICIES.Light;
    expect(p.allowPdf || p.allowConceptPreview || p.allowVideo || p.allowPaidAnalysis).toBe(false);
  });
  it("#25 cost increases with tier (Light < Assisted < Personal)", () => {
    expect(POLICIES.Light.estimatedCost).toBeLessThan(POLICIES.Assisted.estimatedCost);
    expect(POLICIES.Assisted.estimatedCost).toBeLessThan(POLICIES.Personal.estimatedCost);
  });
  it("#18 max touches enforced per strategy", () => {
    expect(stepsFrom("Personal", lead({})).length).toBeLessThanOrEqual(POLICIES.Personal.maxTouches);
    expect(stepsFrom("Light", lead({})).length).toBeLessThanOrEqual(POLICIES.Light.maxTouches);
  });
  it("#19/#20 no SMS and no automated social channels", () => {
    for (const p of Object.values(POLICIES)) expect(["email", "none"]).toContain(p.primaryChannel);
    expect(stepsFrom("Personal", lead({})).every((s) => s.channel === "email")).toBe(true);
  });
});

describe("compliance gates", () => {
  it("a well-formed Assisted plan passes", () => {
    const l = lead({});
    expect(checkPlanCompliance(l, planFor("Assisted"), stepsFrom("Assisted", l), settings()).ok).toBe(true);
  });
  it("#7 suppressed cannot be approved", () => {
    const l = lead({});
    expect(checkPlanCompliance(l, planFor("Assisted"), stepsFrom("Assisted", l), settings(), { suppressed: true }).ok).toBe(false);
  });
  it("#8 invalid recipient email blocks", () => {
    const l = lead({ publicEmail: "not-an-email" });
    const r = checkPlanCompliance(l, planFor("Assisted"), stepsFrom("Assisted", l), settings());
    expect(r.ok).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/recipient email/i);
  });
  it("#9 missing postal address blocks", () => {
    const s = { ...settings(), businessAddress: "" };
    const l = lead({});
    const r = checkPlanCompliance(l, planFor("Assisted"), stepsFrom("Assisted", l, s), s);
    expect(r.ok).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/postal/i);
  });
  it("#10 missing unsubscribe blocks", () => {
    const l = lead({});
    const steps = stepsFrom("Assisted", l).map((s) => ({ ...s, content: s.content.replace(/\{\{unsubscribe\}\}|unsubscribe/gi, "") }));
    expect(checkPlanCompliance(l, planFor("Assisted"), steps, settings()).ok).toBe(false);
  });
  it("#18 sequence exceeding max touches blocks", () => {
    const l = lead({});
    const base = stepsFrom("Light", l);
    const tooMany = [...base, { ...base[0], stepNumber: 3 }, { ...base[0], stepNumber: 4 }];
    expect(checkPlanCompliance(l, planFor("Light"), tooMany, settings()).ok).toBe(false);
  });
  it("deceptive reply-style subject blocks", () => {
    const l = lead({});
    const steps = stepsFrom("Assisted", l).map((s, i) => (i === 0 ? { ...s, subject: "Re: our conversation" } : s));
    expect(checkPlanCompliance(l, planFor("Assisted"), steps, settings()).ok).toBe(false);
  });
});

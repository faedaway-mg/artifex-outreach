// Focused test (mandate A): a follow-up can NEVER precede a provider-accepted initial. The send core
// (dispatchStep) skips a step-2 whose step-1 hasn't sent, and dispatches it only once the intro is sent.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { insertLead, insertPlan, insertStep, updateStep } from "../repo";
import { dispatchStep } from "./dispatch";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

async function seedLead(): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Guard Co", normalizedName: "guardco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://g.example", websiteDomain: "g.example",
    publicEmail: "owner@g.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {} as any, pipelineStage: "Contacted", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}

beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); });
afterEach(() => { clearResendTestEnv(); vi.restoreAllMocks(); });

describe("dispatchStep — follow-up requires a provider-accepted initial", () => {
  it("skips a follow-up (step 2) while its intro (step 1) is unsent", async () => {
    const lead = await seedLead();
    const plan = await insertPlan({ leadId: lead.id, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null, status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null, approvedBy: "jordan", approvedAt: new Date().toISOString(), startedAt: new Date().toISOString(), pausedAt: null, completedAt: null, pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null, assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan" });
    const s1 = await insertStep({ planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "Intro", content: "Hi. {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: new Date(Date.now() - 86400000).toISOString(), sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
    const s2 = await insertStep({ planId: plan.id, stepNumber: 2, channel: "email", delayDays: 3, subject: "Follow-up", content: "Following up. {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: new Date(Date.now() - 3600000).toISOString(), sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });

    const r = await dispatchStep(s2.id);
    expect(r.outcome).toBe("skipped");
    expect(r.reason).toMatch(/prior initial/i);

    // Once the intro is provider-accepted, the follow-up dispatches.
    global.fetch = resendFetch().fn;
    await updateStep(s1.id, { sentAt: new Date().toISOString(), providerMessageId: "resend-intro", deliveryStatus: "sent" });
    const r2 = await dispatchStep(s2.id);
    expect(r2.outcome).toBe("sent");
  });
});

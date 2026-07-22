import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { insertLead, insertPlan, insertStep } from "../repo";
import { dispatchStep } from "../comms/dispatch";
import { resetEmailProvider } from "../comms/provider";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

// This proves the v2 send reuses the REAL pipeline: dispatchStep sends HTML when
// the step carries it, records the provider id, and NEVER sends twice.

async function seedLead(): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Send Co", normalizedName: "sendco", industry: "Dental practice",
    normalizedCategory: "dentist", categoryGroup: "Health and Wellness", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://s.example", websiteDomain: "s.example",
    publicEmail: "owner@s.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.7, reviewCount: 120,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "A", leadScore: 80,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000,
    recommendedService: "Business Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Personal", acquisitionScore: 80, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}

async function seedStep(leadId: string) {
  const plan = await insertPlan({
    leadId, strategy: "Personal", objective: "o", assetPackage: "Premium", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 4, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.2, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step = await insertStep({
    planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0,
    subject: "A few observations about Send Co",
    content: "Hi there. I spent ten minutes with your practice. {{unsubscribe}}",
    html: `<html><body><p>Hi there.</p><a href="{{unsubscribe}}">unsubscribe</a></body></html>`,
    approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-01T00:00:00Z", sentAt: null,
    providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  });
  return step;
}

const realFetch = global.fetch;
let sends: any[] = [];

beforeEach(() => {
  __resetStoreForTests();
  sends = [];
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM = "Jordan <hello@artifexlabs.tech>";
  resetEmailProvider();
  global.fetch = vi.fn(async (_url: any, init: any) => {
    sends.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ id: "prov_msg_1" }), text: async () => "{}" } as unknown as Response;
  }) as any;
});
afterEach(() => { global.fetch = realFetch; resetEmailProvider(); vi.restoreAllMocks(); });

describe("v2 send reuses the real dispatch pipeline", () => {
  it("sends HTML + text through the provider and records the provider id", async () => {
    const lead = await seedLead();
    const step = await seedStep(lead.id);
    const res = await dispatchStep(step.id);
    expect(res.outcome).toBe("sent");
    expect(res.providerMessageId).toBe("prov_msg_1");
    expect(sends).toHaveLength(1);
    // HTML delivered, with the {{unsubscribe}} token resolved to a real URL
    expect(sends[0].html).toContain("<p>Hi there.</p>");
    expect(sends[0].html).not.toContain("{{unsubscribe}}");
    expect(sends[0].text).toContain("I spent ten minutes");
  });

  it("is idempotent — a second dispatch does not send again", async () => {
    const lead = await seedLead();
    const step = await seedStep(lead.id);
    const first = await dispatchStep(step.id);
    const second = await dispatchStep(step.id);
    expect(first.outcome).toBe("sent");
    expect(second.outcome).toBe("deduped");
    expect(sends).toHaveLength(1); // exactly one real send
  });

  it("never fakes a send when the provider is disabled", async () => {
    delete process.env.RESEND_API_KEY;
    resetEmailProvider();
    const lead = await seedLead();
    const step = await seedStep(lead.id);
    const res = await dispatchStep(step.id);
    expect(res.outcome).toBe("skipped");
    expect(res.reason).toMatch(/disabled/i);
    expect(sends).toHaveLength(0);
  });
});

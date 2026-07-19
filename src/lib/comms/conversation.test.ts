import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { insertLead, insertPlan, insertStep, insertMeeting, insertProposal, updateLead } from "../repo";
import { dispatchStep } from "./dispatch";
import { applyDeliveryEvent } from "./events";
import { ingestInboundReply } from "./reply";
import { conversationState } from "./conversation";
import { resetEmailProvider } from "./provider";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); process.env.RESEND_API_KEY = "re_test"; process.env.RESEND_FROM = "J <j@artifexlabs.tech>"; resetEmailProvider(); });
afterEach(() => { global.fetch = realFetch; resetEmailProvider(); vi.restoreAllMocks(); });

async function seedLead(email = "owner@conv.example"): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Conv Co", normalizedName: "convco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: "https://conv.example", websiteDomain: "conv.example",
    publicEmail: email, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4, reviewCount: 5,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 60,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}
async function seedActivePlan(leadId: string) {
  const plan = await insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step1 = await insertStep({ planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "s1", content: "b {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-01T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
  await insertStep({ planId: plan.id, stepNumber: 2, channel: "email", delayDays: 4, subject: "s2", content: "b2 {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-30T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
  return { plan, step1 };
}

describe("conversationState (Phase 7)", () => {
  it("starts at Prepared with a plan and no sends", async () => {
    const lead = await seedLead();
    await seedActivePlan(lead.id);
    const cs = await conversationState(lead.id);
    expect(cs.currentStage).toBe("Prepared");
    expect(cs.transitions.map((t) => t.stage)).toEqual(["Prepared"]);
  });

  it("advances through Sent → Delivered → Opened → Clicked with timestamps", async () => {
    global.fetch = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "cm1" }), text: async () => "{}" } as unknown as Response)) as unknown as typeof fetch;
    const lead = await seedLead();
    const { step1 } = await seedActivePlan(lead.id);
    await dispatchStep(step1.id);
    await applyDeliveryEvent({ type: "delivered", providerMessageId: "cm1", at: "2026-07-15T10:00:00Z" });
    await applyDeliveryEvent({ type: "opened", providerMessageId: "cm1", at: "2026-07-15T10:05:00Z" });
    await applyDeliveryEvent({ type: "clicked", providerMessageId: "cm1", at: "2026-07-15T10:06:00Z" });

    const cs = await conversationState(lead.id);
    expect(cs.currentStage).toBe("Clicked");
    const stages = cs.transitions.map((t) => t.stage);
    expect(stages).toEqual(["Prepared", "Queued", "Sending", "Sent", "Delivered", "Opened", "Clicked"]);
    // Every transition has a timestamp.
    expect(cs.transitions.every((t) => typeof t.at === "string" && t.at.length > 0)).toBe(true);
  });

  it("advances to Replied on a human reply, then Meeting, Proposal, Won", async () => {
    global.fetch = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "cm2" }), text: async () => "{}" } as unknown as Response)) as unknown as typeof fetch;
    const lead = await seedLead();
    const { step1 } = await seedActivePlan(lead.id);
    await dispatchStep(step1.id);
    await ingestInboundReply({ from: "owner@conv.example", subject: "re", body: "Yes, let's schedule a call", inReplyTo: "cm2" });
    let cs = await conversationState(lead.id);
    expect(cs.currentStage).toBe("Replied");

    await insertMeeting({ leadId: lead.id, contactId: null, scheduledAt: "2026-07-20T17:00:00Z", meetingUrl: null, discoveryQuestions: [], likelyObjections: [], notes: "", nextStep: "", outcome: "scheduled" as any });
    await insertProposal({ leadId: lead.id, number: null, version: 1, status: "sent", amount: 12000, proposalUrl: null, sentAt: "2026-07-22T00:00:00Z", acceptedAt: null });
    cs = await conversationState(lead.id);
    expect(cs.currentStage).toBe("Proposal");

    await updateLead(lead.id, { pipelineStage: "Won" });
    cs = await conversationState(lead.id);
    expect(cs.currentStage).toBe("Won");
    expect(cs.transitions.map((t) => t.stage)).toContain("Won");
  });

  it("does not advance for an out-of-office reply, but records negative flags", async () => {
    global.fetch = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "cm3" }), text: async () => "{}" } as unknown as Response)) as unknown as typeof fetch;
    const lead = await seedLead();
    const { step1 } = await seedActivePlan(lead.id);
    await dispatchStep(step1.id);
    await ingestInboundReply({ from: "owner@conv.example", subject: "auto", body: "I am out of office", inReplyTo: "cm3" });
    await applyDeliveryEvent({ type: "bounced", providerMessageId: "cm3", at: "2026-07-15T11:00:00Z" });
    const cs = await conversationState(lead.id);
    expect(cs.transitions.map((t) => t.stage)).not.toContain("Replied");
    expect(cs.flags).toContain("bounced");
  });
});

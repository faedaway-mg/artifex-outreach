import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { insertLead, insertPlan, insertStep, getPlan, inboundForLead, emailSendsForPlan } from "../repo";
import { dispatchStep } from "./dispatch";
import { classifyReply, ingestInboundReply, normalizeInbound } from "./reply";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); }); // cold outreach delivers via the compliant Resend transport
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); vi.restoreAllMocks(); });

async function seedLead(email = "owner@r.example"): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Reply Co", normalizedName: "replyco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: "https://r.example", websiteDomain: "r.example",
    publicEmail: email, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4, reviewCount: 5,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 60,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}
// Returns the plan + step. When `send` is true, dispatches step 1 via Resend and returns the recorded
// providerMessageId (the real Resend id, e.g. "resend-1") as `pmid` so a reply can reference it via In-Reply-To.
async function seedActivePlan(leadId: string, send = false): Promise<{ plan: Awaited<ReturnType<typeof insertPlan>>; step: Awaited<ReturnType<typeof insertStep>>; pmid: string | null }> {
  const plan = await insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step = await insertStep({
    planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "s", content: "b {{unsubscribe}}",
    approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-01T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  });
  // A second, future step keeps the plan "active" after step 1 sends (so a reply
  // has a live sequence to stop).
  await insertStep({
    planId: plan.id, stepNumber: 2, channel: "email", delayDays: 4, subject: "s2", content: "b2 {{unsubscribe}}",
    approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-30T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  });
  let pmid: string | null = null;
  if (send) {
    global.fetch = resendFetch().fn;
    const r = await dispatchStep(step.id);
    pmid = r.providerMessageId!; // Resend records the real message id (e.g. "resend-1")
  }
  return { plan, step, pmid };
}

describe("classifyReply (Phase 5)", () => {
  const cases: Array<[string, string]> = [
    ["please unsubscribe me from this list", "Unsubscribe"],
    ["I am currently out of office until Monday", "Out Of Office"],
    ["Mail delivery failed: returned to sender", "Bounce"],
    ["You've reached the wrong person, I no longer work here", "Wrong Contact"],
    ["Thanks but we already have an agency we work with", "Already Working With Someone"],
    ["Sure, can we schedule a call next week?", "Meeting Requested"],
    ["This looks interesting, tell me more", "Interested"],
    ["Not right now, maybe circle back next quarter", "Not Now"],
    ["How much does this cost?", "Question"],
    ["k", "Unknown"],
  ];
  for (const [body, expected] of cases) {
    it(`classifies "${body.slice(0, 32)}…" as ${expected}`, () => {
      expect(classifyReply({ subject: "", body }).classification).toBe(expected);
    });
  }
  it("prefers out-of-office over interest signals in an auto-reply", () => {
    expect(classifyReply({ subject: "Auto-reply", body: "I'm out of office but would love to learn more when back" }).classification).toBe("Out Of Office");
  });
});

describe("ingestInboundReply (Phase 5)", () => {
  it("associates by In-Reply-To, stores raw body separately, and stops the sequence", async () => {
    const lead = await seedLead();
    const { plan, pmid } = await seedActivePlan(lead.id, true);
    expect((await emailSendsForPlan(plan.id))[0].status).toBe("sent");

    const raw = "Yes! Can we schedule a call? — Best, Owner";
    const r = await ingestInboundReply({ from: "owner@r.example", subject: "Re: s", body: raw, providerMessageId: "in-1", inReplyTo: pmid! });
    expect(r.leadId).toBe(lead.id);
    expect(r.classification).toBe("Meeting Requested");
    expect(r.stoppedSequence).toBe(true);

    // Raw preserved verbatim; classification stored separately.
    const inbound = await inboundForLead(lead.id);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].bodyRef).toBe(raw);
    expect(inbound[0].classification).toBe("Meeting Requested");
    // Sequence stopped.
    expect((await getPlan(plan.id))!.status).toBe("stopped");
  });

  it("associates by sender email when there is no In-Reply-To", async () => {
    const lead = await seedLead("boss@r.example");
    await seedActivePlan(lead.id);
    const r = await ingestInboundReply({ from: "boss@r.example", subject: "hi", body: "interested, tell me more" });
    expect(r.leadId).toBe(lead.id);
    expect(r.classification).toBe("Interested");
  });

  it("does NOT stop the sequence for an out-of-office auto-reply", async () => {
    const lead = await seedLead();
    const { plan } = await seedActivePlan(lead.id);
    const r = await ingestInboundReply({ from: "owner@r.example", subject: "Automatic reply", body: "I am on vacation until next week" });
    expect(r.classification).toBe("Out Of Office");
    expect(r.stoppedSequence).toBe(false);
    expect((await getPlan(plan.id))!.status).toBe("active");
  });

  it("dedupes a duplicate inbound webhook (same provider id)", async () => {
    const lead = await seedLead();
    await seedActivePlan(lead.id);
    await ingestInboundReply({ from: "owner@r.example", subject: "re", body: "interested", providerMessageId: "in-dup" });
    const second = await ingestInboundReply({ from: "owner@r.example", subject: "re", body: "interested", providerMessageId: "in-dup" });
    expect(second.duplicate).toBe(true);
    expect(await inboundForLead(lead.id)).toHaveLength(1);
  });

  it("stores an unmatched reply for manual review (no lead association)", async () => {
    const r = await ingestInboundReply({ from: "stranger@nowhere.example", subject: "hi", body: "who is this?" });
    expect(r.leadId).toBeNull();
    expect(r.classification).toBe("Question");
  });
});

describe("normalizeInbound (Phase 5)", () => {
  it("extracts sender, subject, body and In-Reply-To from a Resend inbound payload", () => {
    const n = normalizeInbound({ data: { from: "Owner <owner@r.example>", subject: "Re: hi", text: "sounds good", message_id: "in-9", headers: [{ name: "In-Reply-To", value: "sent-9" }] } });
    expect(n).toMatchObject({ from: "owner@r.example", subject: "Re: hi", body: "sounds good", providerMessageId: "in-9", inReplyTo: "sent-9" });
  });
});

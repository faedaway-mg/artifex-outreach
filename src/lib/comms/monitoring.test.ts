import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { insertLead, insertPlan, insertStep } from "../repo";
import { dispatchStep } from "./dispatch";
import { applyDeliveryEvent } from "./events";
import { ingestInboundReply } from "./reply";
import { commsMetrics } from "./monitoring";
import { resetEmailProvider } from "./provider";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

// Cold outreach delivers via the compliant Resend transport. Monitoring's provider.* fields report the
// email provider (getEmailProvider()) — the Resend provider, since configureResendTestEnv sets
// RESEND_API_KEY. resetEmailProvider() re-reads the memoized provider after env changes.
const realFetch = global.fetch;
// One shared Resend fetch double per test, installed here so its message-id counter increments ACROSS the
// several sends a metrics test seeds (resend-1, resend-2, …) — ids stay unique so each delivery/reply
// event matches exactly one send row (a fresh double per send would restart at "resend-1" and collide).
beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); resetEmailProvider(); global.fetch = resendFetch().fn; });
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); resetEmailProvider(); vi.restoreAllMocks(); });

async function seedLead(email: string): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Mon Co", normalizedName: "monco" + email, industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: "https://m.example", websiteDomain: email.split("@")[1],
    publicEmail: email, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4, reviewCount: 5,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 60,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
}
// Dispatches one step via Resend and returns the RECORDED providerMessageId (the real Resend id, e.g.
// "resend-1") so delivery-event / reply payloads can reference the same id the send recorded.
async function sendFor(leadId: string, subject = "s"): Promise<{ step: Awaited<ReturnType<typeof insertStep>>; pmid: string }> {
  const plan = await insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step = await insertStep({ planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject, content: "b {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-01T00:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
  // Uses the shared double installed in beforeEach so this send's id increments (unique across sends).
  const r = await dispatchStep(step.id, { now: new Date("2026-07-15T10:00:00Z") });
  return { step, pmid: r.providerMessageId! };
}

describe("commsMetrics (Phase 8)", () => {
  it("reports volume, funnel rates, and provider status", async () => {
    const now = new Date("2026-07-15T18:00:00Z");
    const a = await seedLead("a@x.example");
    const b = await seedLead("b@y.example");
    const c = await seedLead("c@z.example");
    const sa = await sendFor(a.id);
    const sb = await sendFor(b.id);
    const sc = await sendFor(c.id);
    // a: delivered+opened, b: delivered, c: bounced
    await applyDeliveryEvent({ type: "delivered", providerMessageId: sa.pmid, at: "2026-07-15T10:01:00Z" });
    await applyDeliveryEvent({ type: "opened", providerMessageId: sa.pmid, at: "2026-07-15T10:02:00Z" });
    await applyDeliveryEvent({ type: "delivered", providerMessageId: sb.pmid, at: "2026-07-15T10:01:00Z" });
    await applyDeliveryEvent({ type: "bounced", providerMessageId: sc.pmid, at: "2026-07-15T10:03:00Z" });

    // provider.* reports the email provider (getEmailProvider) — Resend, since the harness sets its key.
    resetEmailProvider();
    const m = await commsMetrics({ now });
    expect(m.volume.sentTotal).toBe(3);
    expect(m.volume.sentToday).toBe(3); // all sent 2026-07-15 LA
    expect(m.rates.delivery).toBeCloseTo(2 / 3, 4);
    expect(m.rates.open).toBeCloseTo(1 / 3, 4);
    expect(m.rates.bounce).toBeCloseTo(1 / 3, 4);
    expect(m.provider.name).toBe("resend");
    expect(m.provider.canSend).toBe(true);
  });

  it("computes queue depth and retry queue", async () => {
    const now = new Date("2026-07-15T18:00:00Z");
    const a = await seedLead("q@x.example");
    // Make this send fail transiently → it lands in the retry queue.
    const plan = await insertPlan({
      leadId: a.id, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
      status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
      approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
      pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
      assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
    });
    const step = await insertStep({ planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "s", content: "b {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt: "2026-07-15T09:00:00Z", sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
    global.fetch = resendFetch({ send: () => 429 }).fn; // Resend maps 429 → retryable "rate_limited"
    await dispatchStep(step.id, { now: new Date("2026-07-15T10:00:00Z") });

    const m = await commsMetrics({ now });
    expect(m.queue.queuedRetries).toBe(1);
    expect(m.retryQueue.count).toBe(1);
    expect(m.retryQueue.items[0].lastErrorCode).toBe("rate_limited");
    expect(m.retryQueue.nextAttemptAt).toBeTruthy();
  });

  it("measures reply volume and average reply latency", async () => {
    const now = new Date("2026-07-15T18:00:00Z");
    const a = await seedLead("r@x.example");
    const s = await sendFor(a.id); // sent at 2026-07-15T10:00:00Z (dispatch now)
    await ingestInboundReply({ from: "r@x.example", subject: "re", body: "interested", inReplyTo: s.pmid, at: "2026-07-15T10:30:00Z" });
    const m = await commsMetrics({ now });
    expect(m.replies.total).toBe(1);
    expect(m.replies.averageReplyMinutes).toBe(30);
  });

  it("reflects a closed sending window", async () => {
    const m = await commsMetrics({ now: new Date("2026-07-12T12:00:00Z") }); // Sunday 05:00 LA
    expect(m.scheduler.windowOpen).toBe(false);
  });
});

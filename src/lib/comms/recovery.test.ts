import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { insertLead, insertPlan, insertStep, getEmailSendByKey, casEmailSendStatus, getStep, updateStep, updatePlan } from "../repo";
import { dispatchStep } from "./dispatch";
import { runDueSends } from "./scheduler";
import { commsMetrics } from "./monitoring";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
import { STUCK_SENDING_MS } from "./state";
import { __resetStoreForTests } from "../store";
import type { Lead } from "../types";

const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); }); // cold outreach delivers via the compliant Resend transport
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); vi.restoreAllMocks(); });

async function seedStep(scheduledAt = "2026-07-15T09:00:00Z") {
  const lead: Lead = await insertLead({
    googlePlaceId: null, businessName: "Rec Co", normalizedName: "recco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: "https://rec.example", websiteDomain: "rec.example",
    publicEmail: "owner@rec.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4, reviewCount: 5,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 60,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "x", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
  const plan = await insertPlan({
    leadId: lead.id, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step = await insertStep({ planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "s", content: "b {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved", scheduledAt, sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
  return { lead, plan, step };
}

describe("failure recovery (Phase 9)", () => {
  it("expired API key NEVER loses the message — it stays queued and sends after the key is fixed", async () => {
    const { step } = await seedStep();
    global.fetch = resendFetch({ send: () => 401 }).fn; // 401 → account-level auth → stays queued

    // Simulate the key being expired across many scheduler ticks.
    for (let i = 0; i < 8; i++) {
      const now = new Date(Date.parse("2026-07-15T10:00:00Z") + i * 6 * 3600_000); // step past each backoff
      await dispatchStep(step.id, { now });
      const row = await getEmailSendByKey(`step:${step.id}`);
      expect(row!.status).toBe("queued"); // never "failed"
    }

    // Key restored → next dispatch sends.
    global.fetch = resendFetch().fn;
    const r = await dispatchStep(step.id, { now: new Date("2026-07-17T10:00:00Z") });
    expect(r.outcome).toBe("sent");
    expect((await getStep(step.id))!.sentAt).toBeTruthy();
  });

  it("recovers from a network outage: retries then sends once (no duplicates)", async () => {
    const { step } = await seedStep();
    // The first two send attempts hit a transient 5xx (retryable); the third succeeds.
    global.fetch = resendFetch({ send: (n) => (n <= 2 ? 503 : 200) }).fn;
    await dispatchStep(step.id, { now: new Date("2026-07-15T10:00:00Z") });
    await dispatchStep(step.id, { now: new Date("2026-07-15T10:10:00Z") });
    const r = await dispatchStep(step.id, { now: new Date("2026-07-15T10:30:00Z") });
    expect(r.outcome).toBe("sent");
    const row = await getEmailSendByKey(`step:${step.id}`);
    expect(row!.status).toBe("sent");
    expect(row!.attempts).toBe(3);
  });

  it("recovers a send stuck 'sending' after a mid-send crash (Railway restart)", async () => {
    const { step } = await seedStep();
    // First attempt 'succeeds' at the provider but we simulate a crash before the
    // ledger/step were updated by forcing the row back to a stale 'sending' state.
    global.fetch = resendFetch().fn;
    const first = await dispatchStep(step.id, { now: new Date("2026-07-15T10:00:00Z") });
    expect(first.outcome).toBe("sent");
    const row = await getEmailSendByKey(`step:${step.id}`);
    // Simulate a crash BEFORE the ledger/step persisted: revert to a stale 'sending'
    // and un-set the step (a real re-send is guarded by the durable email_sends ledger key).
    await casEmailSendStatus(row!.id, "sent", { status: "sending", sendingAt: "2026-07-15T09:00:00Z", sentAt: null });
    await updateStep(step.id, { sentAt: null, providerMessageId: null });
    await updatePlan(step.planId, { status: "active", completedAt: null }); // it auto-completed after the first send

    // A later scheduler tick reclaims the stale 'sending' and completes it.
    const staleAgeNow = new Date(Date.parse("2026-07-15T09:00:00Z") + STUCK_SENDING_MS + 60_000);
    const r = await dispatchStep(step.id, { now: staleAgeNow });
    expect(r.outcome).toBe("sent");
    expect((await getEmailSendByKey(`step:${step.id}`))!.status).toBe("sent");
  });

  it("drains the queue through the scheduler once the provider recovers", async () => {
    const { step } = await seedStep();
    global.fetch = resendFetch({ send: () => 429 }).fn;
    await runDueSends({ now: new Date("2026-07-15T10:00:00Z"), force: true });
    expect((await getEmailSendByKey(`step:${step.id}`))!.status).toBe("queued");

    global.fetch = resendFetch().fn;
    const summary = await runDueSends({ now: new Date("2026-07-15T11:00:00Z"), force: true });
    expect(summary.sent).toBe(1);
    expect((await getEmailSendByKey(`step:${step.id}`))!.status).toBe("sent");
  });

  it("surfaces an auth-failure alert in monitoring", async () => {
    const { step } = await seedStep();
    global.fetch = resendFetch({ send: () => 401 }).fn; // 401 → lastErrorCode "auth"
    await dispatchStep(step.id, { now: new Date("2026-07-15T10:00:00Z") });
    const m = await commsMetrics({ now: new Date("2026-07-15T18:00:00Z") });
    expect(m.alerts.some((a) => a.includes("auth failing"))).toBe(true);
  });
});

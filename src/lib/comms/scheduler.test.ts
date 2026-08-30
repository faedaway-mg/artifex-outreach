import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { insertLead, insertPlan, insertStep, updateEmailSend, getEmailSendByKey } from "../repo";
import { withinSendingWindow, dueStepIds, runDueSends } from "./scheduler";
import { dispatchStep } from "./dispatch";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
import { backoffMs } from "./state";
import { __resetStoreForTests } from "../store";
import type { Lead, SendingWindow } from "../types";

async function seedLead(over: Partial<Lead> = {}): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Sched Co", normalizedName: "schedco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://s.example", websiteDomain: "s.example",
    publicEmail: "owner@s.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
  } as any);
}
async function seedStep(leadId: string, scheduledAt: string) {
  const plan = await insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: "2026-07-01T00:00:00Z", startedAt: "2026-07-01T00:00:00Z", pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step = await insertStep({
    planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "Note", content: "Hi. {{unsubscribe}}",
    approvalRequired: false, approvalStatus: "approved", scheduledAt, sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  });
  return { plan, step };
}
const realFetch = global.fetch;
beforeEach(() => { __resetStoreForTests(); configureResendTestEnv(); }); // cold outreach delivers via the compliant Resend transport
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); vi.restoreAllMocks(); });

const UTC_WINDOW: SendingWindow = { timezone: "UTC", startHour: 8, endHour: 17, weekdays: [1, 2, 3, 4, 5] };

describe("withinSendingWindow (Phase 3)", () => {
  it("is open on a weekday inside business hours", () => {
    expect(withinSendingWindow(new Date("2026-07-15T10:00:00Z"), UTC_WINDOW)).toBe(true); // Wed 10:00 UTC
  });
  it("is closed outside business hours", () => {
    expect(withinSendingWindow(new Date("2026-07-15T20:00:00Z"), UTC_WINDOW)).toBe(false); // Wed 20:00
  });
  it("is closed on weekends", () => {
    expect(withinSendingWindow(new Date("2026-07-11T10:00:00Z"), UTC_WINDOW)).toBe(false); // Sat
  });
});

describe("dueStepIds (Phase 3)", () => {
  it("includes a due, never-attempted step", async () => {
    const lead = await seedLead();
    const { step } = await seedStep(lead.id, "2026-07-15T09:00:00Z");
    const ids = await dueStepIds(new Date("2026-07-15T10:00:00Z"));
    expect(ids).toContain(step.id);
  });
  it("excludes a step scheduled in the future", async () => {
    const lead = await seedLead();
    const { step } = await seedStep(lead.id, "2026-07-20T09:00:00Z");
    const ids = await dueStepIds(new Date("2026-07-15T10:00:00Z"));
    expect(ids).not.toContain(step.id);
  });
  it("excludes a queued retry until its backoff elapses", async () => {
    global.fetch = resendFetch({ send: () => 429 }).fn;
    const lead = await seedLead();
    const now = new Date("2026-07-15T10:00:00Z");
    const { step } = await seedStep(lead.id, "2026-07-15T09:00:00Z");
    await dispatchStep(step.id, { now }); // → queued with backoff
    const row = await getEmailSendByKey(`step:${step.id}`);
    expect(row!.status).toBe("queued");

    // Immediately after: excluded (backoff not elapsed).
    expect(await dueStepIds(now)).not.toContain(step.id);
    // After the backoff window: included again.
    const later = new Date(now.getTime() + backoffMs(1) + 1000);
    expect(await dueStepIds(later)).toContain(step.id);
  });
  it("excludes an already-sent step", async () => {
    global.fetch = resendFetch().fn;
    const lead = await seedLead();
    const now = new Date("2026-07-15T10:00:00Z");
    const { step } = await seedStep(lead.id, "2026-07-15T09:00:00Z");
    await dispatchStep(step.id, { now });
    expect(await dueStepIds(now)).not.toContain(step.id);
  });
});

describe("runDueSends (Phase 3)", () => {
  it("sends all due steps once when forced past the window", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead();
    await seedStep(lead.id, "2026-07-15T09:00:00Z");
    const summary = await runDueSends({ now: new Date("2026-07-15T10:00:00Z"), force: true });
    expect(summary.sent).toBe(1);
    expect(rf.calls.send).toBe(1); // exactly one send (Resend makes a single POST /emails)
  });
  it("does nothing when the business-hours window is closed", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead();
    await seedStep(lead.id, "2026-07-12T00:00:00Z");
    // Sunday 05:00 America/Los_Angeles → window closed (default settings window).
    const summary = await runDueSends({ now: new Date("2026-07-12T12:00:00Z") });
    expect(summary.windowOpen).toBe(false);
    expect(summary.considered).toBe(0);
    expect(rf.calls.all).toBe(0); // nothing attempted
  });
  it("surfaces permanent failures in the summary", async () => {
    global.fetch = resendFetch({ send: () => 422 }).fn;
    const lead = await seedLead();
    const { step } = await seedStep(lead.id, "2026-07-15T09:00:00Z");
    const summary = await runDueSends({ now: new Date("2026-07-15T10:00:00Z"), force: true });
    expect(summary.failed).toBe(1);
    expect(summary.failures[0].stepId).toBe(step.id);
  });
});

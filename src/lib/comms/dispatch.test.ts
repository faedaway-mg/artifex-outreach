import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  insertLead, insertPlan, insertStep, getStep, stepsForPlan, addSuppression,
  emailSendsForPlan, getEmailSendByKey, updatePlan,
} from "../repo";
import { dispatchStep } from "./dispatch";
import { resetEmailProvider } from "./provider";
import { __resetStoreForTests } from "../store";
import type { Lead, AcquisitionPlan, AcquisitionStep } from "../types";

// ── Seed helpers (in-memory backend; unique ids avoid seed-data collisions) ────
async function seedLead(over: Partial<Lead> = {}): Promise<Lead> {
  return insertLead({
    googlePlaceId: null, businessName: "Dispatch Co", normalizedName: "dispatchco", industry: "Auto repair",
    normalizedCategory: "auto-repair", categoryGroup: "Automotive", address: "1 St", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://d.example", websiteDomain: "d.example",
    publicEmail: "owner@d.example", contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: 4.5, reviewCount: 20,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "test", retrievedAt: null, tier: "B", leadScore: 70,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: 5000, estimatedValueHigh: 9000,
    recommendedService: "Website System", recommendedAction: "x", recommendationReason: null, opportunitySummary: "x", strengths: [],
    acquisitionStrategy: "Assisted", acquisitionScore: 60, acquisitionReason: "x", acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
  } as any);
}

async function seedApprovedPlan(leadId: string): Promise<{ plan: AcquisitionPlan; step: AcquisitionStep }> {
  const plan = await insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: new Date().toISOString(), startedAt: new Date().toISOString(), pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step = await insertStep({
    planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0, subject: "A quick note",
    content: "Hi there. {{unsubscribe}}", approvalRequired: false, approvalStatus: "approved",
    scheduledAt: new Date().toISOString(), sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  });
  return { plan, step };
}

function okResponse(id = "resend-1"): Response {
  return { ok: true, status: 200, json: async () => ({ id }), text: async () => JSON.stringify({ id }) } as unknown as Response;
}
function errResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}), text: async () => "err" } as unknown as Response;
}

const realFetch = global.fetch;
beforeEach(() => {
  __resetStoreForTests();
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM = "Jordan <jordan@artifexlabs.tech>";
  resetEmailProvider();
});
afterEach(() => { global.fetch = realFetch; resetEmailProvider(); vi.restoreAllMocks(); });

describe("dispatchStep — idempotent sending (Phase 2)", () => {
  it("sends exactly once and marks the step + ledger row sent", async () => {
    const fetchMock = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve(okResponse("m1")));
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);

    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("sent");
    expect(r.providerMessageId).toBe("m1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const sends = await emailSendsForPlan(plan.id);
    expect(sends).toHaveLength(1);
    expect(sends[0].status).toBe("sent");
    expect(sends[0].idempotencyKey).toBe(`step:${step.id}`);
    const after = await getStep(step.id);
    expect(after!.sentAt).toBeTruthy();
    expect(after!.providerMessageId).toBe("m1");
  });

  it("never sends twice — a second dispatch is deduped, no second provider call", async () => {
    const fetchMock = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve(okResponse()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);

    await dispatchStep(step.id);
    const second = await dispatchStep(step.id);
    expect(second.outcome).toBe("deduped");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await emailSendsForPlan(plan.id)).toHaveLength(1);
  });

  it("survives concurrent duplicate dispatch (double-submit / duplicate scheduler run)", async () => {
    const fetchMock = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve(okResponse()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);

    const results = await Promise.all([dispatchStep(step.id), dispatchStep(step.id), dispatchStep(step.id)]);
    const sent = results.filter((r) => r.outcome === "sent");
    expect(sent).toHaveLength(1); // exactly one send wins
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await emailSendsForPlan(plan.id)).toHaveLength(1);
  });

  it("re-queues a transient failure and sends once on the following attempt", async () => {
    let call = 0;
    global.fetch = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve(++call === 1 ? errResponse(429) : okResponse("m2"))) as unknown as typeof fetch;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);

    const first = await dispatchStep(step.id);
    expect(first.outcome).toBe("retry");
    let sends = await emailSendsForPlan(plan.id);
    expect(sends[0].status).toBe("queued");
    expect(sends[0].nextAttemptAt).toBeTruthy();
    expect((await getStep(step.id))!.sentAt).toBeNull();

    const second = await dispatchStep(step.id);
    expect(second.outcome).toBe("sent");
    sends = await emailSendsForPlan(plan.id);
    expect(sends).toHaveLength(1); // still one row — the same send retried
    expect(sends[0].status).toBe("sent");
    expect(sends[0].attempts).toBe(2);
  });

  it("marks a permanent (validation) failure as failed with no retry", async () => {
    global.fetch = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve(errResponse(422))) as unknown as typeof fetch;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("failed");
    const sends = await emailSendsForPlan(plan.id);
    expect(sends[0].status).toBe("failed");
    expect((await getStep(step.id))!.sentAt).toBeNull();
  });

  it("skips (and releases the claim) when no provider is configured — nothing lost", async () => {
    delete process.env.RESEND_API_KEY;
    resetEmailProvider();
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await getEmailSendByKey(`step:${step.id}`);
    expect(row!.status).toBe("queued"); // released for a later configured run
  });

  it("skips a suppressed recipient and stops the plan (never sends)", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead({ publicEmail: "stop@d.example" });
    const { plan, step } = await seedApprovedPlan(lead.id);
    await addSuppression({ email: "stop@d.example", domain: null, phone: null, reason: "opt-out" });
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("skipped");
    expect(r.reason).toBe("suppressed");
    expect(fetchMock).not.toHaveBeenCalled();
    const { getPlan } = await import("../repo");
    expect((await getPlan(plan.id))!.status).toBe("stopped");
  });

  it("skips a paused plan", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);
    await updatePlan(plan.id, { status: "paused" });
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

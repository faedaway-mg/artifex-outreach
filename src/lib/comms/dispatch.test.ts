import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  insertLead, insertPlan, insertStep, getStep, stepsForPlan, addSuppression,
  emailSendsForPlan, getEmailSendByKey, updatePlan, getLead, listAudit,
  upsertBusinessIntelligence,
} from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { dispatchStep } from "./dispatch";
import { sha256, SEND_RECEIPT_ACTION } from "./receipt";
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
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null, ...over,
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
    fetchMock.mockClear(); // ignore analyzeBusiness website fetches — count only the send
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

  it("writes an immutable receipt bound to the business, and marks the lead contacted", async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResponse("m1"))) as unknown as typeof fetch;
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    await dispatchStep(step.id);

    const receipts = (await listAudit(50)).filter((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id);
    expect(receipts).toHaveLength(1);
    const m = receipts[0].meta as { leadId: string; subject: string; bodyText: string; bodySha256: string; providerMessageId: string };
    expect(m.leadId).toBe(lead.id);
    expect(m.subject).toBeTruthy();
    expect(m.bodySha256).toBe(sha256(m.bodyText)); // body hash matches the recorded body
    expect(m.providerMessageId).toBe("m1");

    // Pipeline visibility: the emailed business is no longer indistinguishable from an untouched one.
    const after = await getLead(lead.id);
    expect(after!.lastContactAt).toBeTruthy();
    expect(after!.pipelineStage).toBe("Contacted");
  });

  it("a FAILED send writes NO receipt and does not mark the lead contacted", async () => {
    global.fetch = vi.fn(() => Promise.resolve(errResponse(400))) as unknown as typeof fetch; // permanent
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("failed");
    expect((await listAudit(50)).filter((a) => a.action === SEND_RECEIPT_ACTION)).toHaveLength(0);
    expect((await getLead(lead.id))!.lastContactAt).toBeNull(); // no false "contacted"
  });

  it("an idempotent retry does not write a second receipt", async () => {
    global.fetch = vi.fn(() => Promise.resolve(okResponse("m1"))) as unknown as typeof fetch;
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    await dispatchStep(step.id);
    await dispatchStep(step.id); // deduped
    expect((await listAudit(50)).filter((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id)).toHaveLength(1);
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

// Make a seeded BI's Quick Review SENDABLE (two Observed findings, distinct consequences).
function makeSendable<T extends { businessProfile: { opportunities: any[] } }>(bi: T): T {
  const ev = (category: string, observation: string, why: string) => ({
    id: category, category, observation, whyItMatters: why,
    estimatedImpact: { level: "High", rationale: "A concrete fix." }, confidence: { label: "Observed", score: 0.95 }, basis: ["public website HTML"],
  });
  bi.businessProfile.opportunities = [
    ev("Scheduling", "The site has no online booking — reservations require a phone call during business hours.", "New customers who won't call during business hours quietly drop off before they ever reach the desk."),
    ev("Brand Experience", "The homepage has no clear primary call to action for a first-time visitor.", "A first-time visitor with no obvious next move is the one most likely to leave without acting."),
    ...bi.businessProfile.opportunities,
  ];
  return bi;
}

describe("dispatchStep — Gate 7 universal review delivery protection", () => {
  it("BLOCKS (never bare-sends) an initial email when its review-bearing lead has NO delivery-ready Quick Review", async () => {
    const fetchMock = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve(okResponse("nope")));
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead();
    // Plain BI (no injected findings) → INSUFFICIENT_EVIDENCE → review is NOT delivery-ready.
    const bi = await analyzeBusiness({ lead, findings: [], contacts: [] } as any);
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi as any, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("failed"); // fail closed — the whole outreach is blocked
    const send = await getEmailSendByKey(`step:${step.id}`);
    expect(send!.status).toBe("failed");
    expect(send!.lastErrorCode).toBe("review_not_ready");
    // Canonical proof no bare email shipped: a blocked send writes NO immutable receipt and the
    // step is never marked sent. (fetch count is not a clean signal — the legacy path resolves brand
    // assets over the network before the readiness check.)
    expect((await listAudit(50)).filter((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id)).toHaveLength(0);
    expect((await getStep(step.id))!.sentAt).toBeNull();
  });

  it("SENDS with the review attached when the legacy (unedited) review IS delivery-ready", async () => {
    const fetchMock = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve(okResponse("m-ready")));
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead();
    const bi = makeSendable(await analyzeBusiness({ lead, findings: [], contacts: [] } as any));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi as any, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("sent");
    // The immutable receipt proves the exact Quick Review PDF (by filename + hash) actually shipped — not bare.
    const receipt = (await listAudit(50)).find((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id);
    expect(receipt).toBeTruthy();
    expect((receipt!.meta as any).attachmentFilename).toBeTruthy();
    expect((receipt!.meta as any).attachmentSha256).toBeTruthy();
  });

  it("still bare-sends a lead with NO review profile at all (non-review outreach is unaffected)", async () => {
    const fetchMock = vi.fn((_u: string | URL | Request, _i?: RequestInit) => Promise.resolve(okResponse("m-plain")));
    global.fetch = fetchMock as unknown as typeof fetch;
    const lead = await seedLead(); // no BI seeded → profile is null → guard does not apply
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

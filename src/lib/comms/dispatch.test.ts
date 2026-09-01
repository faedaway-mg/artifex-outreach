import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  insertLead, insertPlan, insertStep, getStep, stepsForPlan, addSuppression,
  emailSendsForPlan, getEmailSendByKey, updatePlan, getLead, listAudit,
  upsertBusinessIntelligence, updateSettings,
} from "../repo";
import { analyzeBusiness } from "../intelligence/engine";
import { dispatchStep } from "./dispatch";
import { sha256, SEND_RECEIPT_ACTION } from "./receipt";
import { configureResendTestEnv, clearResendTestEnv, resendFetch } from "./resend-test-harness";
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

const realFetch = global.fetch;
beforeEach(() => {
  __resetStoreForTests();
  configureResendTestEnv(); // cold outreach delivers via the compliant Resend transport
});
afterEach(() => { global.fetch = realFetch; clearResendTestEnv(); vi.restoreAllMocks(); });

describe("dispatchStep — idempotent sending (Phase 2)", () => {
  it("sends exactly once and marks the step + ledger row sent", async () => {
    const rf = resendFetch(); // 200 = accepted; providerMessageId = the Resend id
    global.fetch = rf.fn;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("sent");
    expect(r.providerMessageId).toBe("resend-1"); // truthful state: the real provider message id
    expect(rf.calls.send).toBe(1);

    const sends = await emailSendsForPlan(plan.id);
    expect(sends).toHaveLength(1);
    expect(sends[0].status).toBe("sent");
    expect(sends[0].idempotencyKey).toBe(`step:${step.id}`);
    expect(sends[0].provider).toBe("resend");
    const after = await getStep(step.id);
    expect(after!.sentAt).toBeTruthy();
    expect(after!.providerMessageId).toBe("resend-1");
  });

  it("writes an immutable receipt bound to the business, and marks the lead contacted", async () => {
    global.fetch = resendFetch().fn;
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    await dispatchStep(step.id);

    const receipts = (await listAudit(50)).filter((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id);
    expect(receipts).toHaveLength(1);
    const m = receipts[0].meta as { leadId: string; subject: string; bodyText: string; bodySha256: string; providerMessageId: string };
    expect(m.leadId).toBe(lead.id);
    expect(m.subject).toBeTruthy();
    expect(m.bodySha256).toBe(sha256(m.bodyText)); // body hash matches the recorded (footer-included) body
    expect(m.bodyText).toContain("Artifex Labs Systems LLC"); // compliant footer is part of what shipped
    expect(m.providerMessageId).toBe("resend-1");

    const after = await getLead(lead.id);
    expect(after!.lastContactAt).toBeTruthy();
    expect(after!.pipelineStage).toBe("Contacted");
  });

  it("a FAILED send writes NO receipt and does not mark the lead contacted", async () => {
    global.fetch = resendFetch({ send: () => 400 }).fn; // permanent
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("failed");
    expect((await listAudit(50)).filter((a) => a.action === SEND_RECEIPT_ACTION)).toHaveLength(0);
    expect((await getLead(lead.id))!.lastContactAt).toBeNull(); // no false "contacted"
  });

  it("an idempotent retry does not write a second receipt", async () => {
    global.fetch = resendFetch().fn;
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    await dispatchStep(step.id);
    await dispatchStep(step.id); // deduped
    expect((await listAudit(50)).filter((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id)).toHaveLength(1);
  });

  it("never sends twice — a second dispatch is deduped, no second provider call", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);

    await dispatchStep(step.id);
    const second = await dispatchStep(step.id);
    expect(second.outcome).toBe("deduped");
    expect(rf.calls.send).toBe(1);
    expect(await emailSendsForPlan(plan.id)).toHaveLength(1);
  });

  it("survives concurrent duplicate dispatch (double-submit / duplicate scheduler run)", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);

    const results = await Promise.all([dispatchStep(step.id), dispatchStep(step.id), dispatchStep(step.id)]);
    const sent = results.filter((r) => r.outcome === "sent");
    expect(sent).toHaveLength(1); // exactly one send wins
    expect(rf.calls.send).toBe(1);
    expect(await emailSendsForPlan(plan.id)).toHaveLength(1);
  });

  it("re-queues a transient failure and sends once on the following attempt", async () => {
    global.fetch = resendFetch({ send: (n) => (n === 1 ? 429 : 200) }).fn;
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
    global.fetch = resendFetch({ send: () => 422 }).fn;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("failed");
    const sends = await emailSendsForPlan(plan.id);
    expect(sends[0].status).toBe("failed");
    expect((await getStep(step.id))!.sentAt).toBeNull();
  });

  it("an AMBIGUOUS send (network fault after submit) fails closed — never blindly resent", async () => {
    global.fetch = resendFetch({ send: () => ({ throw: true }) }).fn;
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("failed");
    const row = await getEmailSendByKey(`step:${step.id}`);
    expect(row!.status).toBe("failed");
    expect(row!.lastErrorCode).toBe("ambiguous_submit"); // terminal — the ledger blocks any resend
  });

  it("skips (and releases the claim) when the transport is unconfigured — nothing lost", async () => {
    delete process.env.RESEND_API_KEY;
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("skipped");
    expect(rf.calls.all).toBe(0); // nothing attempted
    const row = await getEmailSendByKey(`step:${step.id}`);
    expect(row!.status).toBe("queued"); // released for a later configured run
    expect(row!.provider).toBe("resend");
  });

  it("skips a suppressed recipient and stops the plan (never sends)", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead({ publicEmail: "stop@d.example" });
    const { plan, step } = await seedApprovedPlan(lead.id);
    await addSuppression({ email: "stop@d.example", domain: null, phone: null, reason: "opt-out" });
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("skipped");
    expect(r.reason).toBe("suppressed");
    expect(rf.calls.all).toBe(0);
    const { getPlan } = await import("../repo");
    expect((await getPlan(plan.id))!.status).toBe("stopped");
  });

  it("skips a paused plan", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead();
    const { plan, step } = await seedApprovedPlan(lead.id);
    await updatePlan(plan.id, { status: "paused" });
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("skipped");
    expect(rf.calls.all).toBe(0);
  });
});

// A fetch double for Resend that ALSO records the Idempotency-Key header per POST (the shared harness
// records only bodies). Lets us prove the PROVIDER key is attempt-scoped while the ledger key is stable.
function resendFetchWithHeaders(opts: { send?: (n: number) => number } = {}): { fn: typeof fetch; calls: { send: number; idemKeys: string[] } } {
  const calls = { send: 0, idemKeys: [] as string[] };
  const status = opts.send ?? (() => 200);
  const fn = (async (_url: any, init?: any) => {
    calls.send++;
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.idemKeys.push(h["Idempotency-Key"] ?? "");
    const r = status(calls.send);
    return { ok: r < 400, status: r, json: async () => ({ id: `resend-${calls.send}` }), text: async () => `status ${r}` };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("dispatchStep — operator 'Try send again' (config/transient recovery, terminal stays blocked)", () => {
  // Force the exact production incident: no postal address anywhere → the CAN-SPAM footer can't assemble
  // → the row is stamped failed/compliance_incomplete WITHOUT ever contacting the provider.
  async function seedMissingPostal() {
    configureResendTestEnv({ COMMS_POSTAL_ADDRESS: "" }); // env postal empty
    await updateSettings({ businessAddress: "" });        // and the Settings fallback empty
    const lead = await seedLead({ businessName: "Same Day Marriage", publicEmail: "info@samedaymarriage.com" });
    const { plan, step } = await seedApprovedPlan(lead.id);
    return { lead, plan, step };
  }

  it("reclaims a missing-postal (compliance) failure and SENDS once when the address is supplied — provider key is attempt-scoped, ledger key is stable", async () => {
    const rf = resendFetchWithHeaders();
    global.fetch = rf.fn;
    const { lead, step } = await seedMissingPostal();

    // Attempt 1: fails at footer assembly, provider NEVER contacted.
    const first = await dispatchStep(step.id);
    expect(first.outcome).toBe("failed");
    expect(first.reason).not.toMatch(/previously failed permanently/i); // specific, not generic
    let row = await getEmailSendByKey(`step:${step.id}`);
    expect(row!.status).toBe("failed");
    expect(row!.lastErrorCode).toBe("compliance_incomplete");
    expect(rf.calls.send).toBe(0); // Resend was never contacted

    // The operator fixes the mailing address in Settings, then presses "Try send again".
    await updateSettings({ businessAddress: "Artifex Labs Systems LLC, 5 Ops Ave, Los Angeles, CA 90001" });
    const retry = await dispatchStep(step.id, { operatorRetry: true });
    expect(retry.outcome).toBe("sent");
    expect(rf.calls.send).toBe(1); // exactly one delivery
    expect(rf.calls.idemKeys[0]).toBe(`step:${step.id}:a2`); // attempt-scoped provider key (2nd attempt)

    row = await getEmailSendByKey(`step:${step.id}`);
    expect(row!.status).toBe("sent");
    expect(row!.idempotencyKey).toBe(`step:${step.id}`); // durable ledger key unchanged → lineage + dedup intact
    expect(row!.attempts).toBe(2);
    expect(row!.providerMessageId).toBe("resend-1");
    // The retry is audited.
    expect((await listAudit(50)).some((a) => a.action === "email.send.retry" && a.targetId === lead.id)).toBe(true);
  });

  it("the AUTOMATIC scheduler (no operatorRetry) never resurrects a config failure — a failed row stays failed", async () => {
    const rf = resendFetchWithHeaders();
    global.fetch = rf.fn;
    const { step } = await seedMissingPostal();

    expect((await dispatchStep(step.id)).outcome).toBe("failed");
    // Even though the address is now available, a scheduler-style call must NOT auto-send it.
    await updateSettings({ businessAddress: "Artifex Labs Systems LLC, 5 Ops Ave, Los Angeles, CA 90001" });
    const again = await dispatchStep(step.id); // no operatorRetry
    expect(again.outcome).toBe("failed");
    expect(rf.calls.send).toBe(0); // never contacted the provider
    expect((await getEmailSendByKey(`step:${step.id}`))!.status).toBe("failed");
  });

  it("an operator retry does NOT resurrect a GENUINE terminal failure (provider validation reject)", async () => {
    const rf = resendFetch({ send: () => 422 }); // hard validation reject
    global.fetch = rf.fn;
    const lead = await seedLead();
    const { step } = await seedApprovedPlan(lead.id);

    expect((await dispatchStep(step.id)).outcome).toBe("failed");
    expect((await getEmailSendByKey(`step:${step.id}`))!.lastErrorCode).toBe("validation");
    const retry = await dispatchStep(step.id, { operatorRetry: true });
    expect(retry.outcome).toBe("failed");
    expect(retry.reason).not.toMatch(/previously failed permanently/i);
    expect(rf.calls.send).toBe(1); // the terminal row blocked a second provider contact
  });

  it("repeated concurrent operator retries of a recovered config failure deliver at most once", async () => {
    const rf = resendFetchWithHeaders();
    global.fetch = rf.fn;
    const { step } = await seedMissingPostal();
    await dispatchStep(step.id); // fail (missing postal)
    await updateSettings({ businessAddress: "Artifex Labs Systems LLC, 5 Ops Ave, Los Angeles, CA 90001" });

    const results = await Promise.all([
      dispatchStep(step.id, { operatorRetry: true }),
      dispatchStep(step.id, { operatorRetry: true }),
      dispatchStep(step.id, { operatorRetry: true }),
    ]);
    expect(results.filter((r) => r.outcome === "sent")).toHaveLength(1); // exactly one wins
    expect(rf.calls.send).toBe(1);
    expect((await emailSendsForPlan((await getStep(step.id))!.planId))).toHaveLength(1); // still one ledger row
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
    global.fetch = resendFetch().fn;
    const lead = await seedLead();
    const bi = await analyzeBusiness({ lead, findings: [], contacts: [] } as any);
    (bi as any).businessProfile.opportunities = [];
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi as any, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("failed"); // fail closed — the whole outreach is blocked
    const send = await getEmailSendByKey(`step:${step.id}`);
    expect(send!.status).toBe("failed");
    expect(send!.lastErrorCode).toBe("review_not_ready");
    expect((await listAudit(50)).filter((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id)).toHaveLength(0);
    expect((await getStep(step.id))!.sentAt).toBeNull();
  });

  it("SENDS with the review attached when the legacy (unedited) review IS delivery-ready", async () => {
    global.fetch = resendFetch().fn;
    const lead = await seedLead();
    const bi = makeSendable(await analyzeBusiness({ lead, findings: [], contacts: [] } as any));
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi as any, enrichmentDelta: null, generatedAt: "2026-07-22T00:00:00.000Z" });
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("sent");
    const receipt = (await listAudit(50)).find((a) => a.action === SEND_RECEIPT_ACTION && a.targetId === lead.id);
    expect(receipt).toBeTruthy();
    expect((receipt!.meta as any).attachmentFilename).toBeTruthy();
    expect((receipt!.meta as any).attachmentSha256).toBeTruthy();
  });

  it("still bare-sends a lead with NO review profile at all (non-review outreach is unaffected)", async () => {
    const rf = resendFetch();
    global.fetch = rf.fn;
    const lead = await seedLead(); // no BI seeded → profile is null → guard does not apply
    const { step } = await seedApprovedPlan(lead.id);
    const r = await dispatchStep(step.id);
    expect(r.outcome).toBe("sent");
    expect(rf.calls.send).toBe(1);
  });
});

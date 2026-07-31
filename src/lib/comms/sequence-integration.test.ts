import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ headers: () => new Map() }));

import { __resetStoreForTests } from "../store";
import {
  insertLead, insertPlan, insertStep, allTasks, listLeads,
  upsertBusinessIntelligence, insertEmailSendIfAbsent, emailSendsForLead, getStep, getTask,
} from "../repo";
import { materializeDueSteps } from "./task-projection";
import { resetEmailProvider } from "./provider";
import { scheduleFollowUps } from "../followups";
import { analyzeBusiness } from "../intelligence/engine";
import { sendFollowUpAction } from "../outreach/send-actions";
import { completeTaskAction } from "../actions";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const daysAhead = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function seedLead(over: Partial<Lead> = {}) {
  const base = makeLead({ publicEmail: "hi@x.com", ...over });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = base;
  return insertLead(rest);
}
async function seedPlan(leadId: string, over: any = {}) {
  return insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused",
    primaryChannel: "email", secondaryChannel: "call", status: "active", approvalStatus: "approved",
    currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: daysAgo(4), startedAt: daysAgo(4), pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15,
    estimatedValueSnapshot: null, assetReadinessSnapshot: null, assetMissingSnapshot: null,
    contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan", ...over,
  } as any);
}
async function seedStep(planId: string, stepNumber: number, over: any = {}) {
  return insertStep({
    planId, stepNumber, channel: "email", delayDays: 0, subject: `s${stepNumber}`, content: `c${stepNumber}`,
    html: null, approvalRequired: false, approvalStatus: "approved", scheduledAt: null, sentAt: null,
    providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null, ...over,
  } as any);
}

describe("9. the legacy follow-up scheduler never competes with the real sequence", () => {
  beforeEach(() => __resetStoreForTests());

  it("no-ops for a lead that has a real acquisition plan", async () => {
    const lead = await seedLead({ businessName: "Planned Co" });
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4) });
    await seedStep(plan.id, 2, { scheduledAt: daysAgo(0) });

    await scheduleFollowUps((await listLeads()).find((l) => l.id === lead.id)!);

    // The legacy day-3/7/14 tasks must NOT exist.
    const legacy = (await allTasks()).filter((t) => t.type === "follow_up" && !t.sourceStepId);
    expect(legacy).toHaveLength(0);
    expect((await listLeads()).find((l) => l.id === lead.id)!.nextFollowUpAt).toBeNull();
  });

  it("still works for a lead with no plan at all (legacy path preserved, isolated)", async () => {
    const lead = await seedLead({ businessName: "Legacy Co" });
    await scheduleFollowUps(lead);
    const legacy = (await allTasks()).filter((t) => t.type === "follow_up" && !t.sourceStepId);
    expect(legacy.length).toBeGreaterThan(0);
  });

  it("projection + legacy together never double-queue the same lead", async () => {
    const lead = await seedLead({ businessName: "Both Co" });
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4) });
    await seedStep(plan.id, 2, { scheduledAt: daysAgo(0) });

    await materializeDueSteps();
    await scheduleFollowUps((await listLeads()).find((l) => l.id === lead.id)!);
    await materializeDueSteps();

    const open = (await allTasks()).filter((t) => t.leadId === lead.id && t.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0].sourceStepId).toBeTruthy();
  });
});

describe("8. sending through the projected task reconciles step, task, and ledger", () => {
  const realFetch = global.fetch;
  let sends: any[] = [];

  beforeEach(() => {
    __resetStoreForTests();
    sends = [];
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM = "Jordan <hello@artifexlabs.tech>";
    process.env.OUTREACH_SENDING_ENABLED = "1";
    resetEmailProvider();
    global.fetch = vi.fn(async (_url: any, init: any) => {
      sends.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: "prov_msg_fu" }), text: async () => "{}" } as unknown as Response;
    }) as any;
  });
  afterEach(() => {
    global.fetch = realFetch;
    resetEmailProvider();
    delete process.env.OUTREACH_SENDING_ENABLED;
    vi.restoreAllMocks();
  });

  it("a follow-up send marks the step sent, writes the ledger, and clears the task", async () => {
    const lead = await seedLead({
      businessName: "Reconcile Dental", industry: "Dental practice", normalizedCategory: "dentist",
      pipelineStage: "Contacted", publicEmail: "office@r.example", website: "https://r.example",
      websiteDomain: "r.example", tier: "A", leadScore: 82, acquisitionStrategy: "Assisted",
    });
    const bi = await analyzeBusiness({ lead, findings: [], contacts: [] });
    await upsertBusinessIntelligence({ leadId: lead.id, profile: bi, enrichmentDelta: null, generatedAt: daysAgo(5) });

    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4), deliveryStatus: "sent" });
    const s2 = await seedStep(plan.id, 2, { delayDays: 4, scheduledAt: daysAgo(0) });

    // The ledger must already show the intro, or the follow-up guard refuses.
    await insertEmailSendIfAbsent({
      idempotencyKey: "seed-intro", stepId: null, planId: plan.id, leadId: lead.id,
      toAddr: lead.publicEmail!, fromAddr: "a@b.c", subject: "intro", status: "sent",
      provider: "resend", providerMessageId: "m1", attempts: 1, lastError: null, lastErrorCode: null,
      nextAttemptAt: null, queuedAt: daysAgo(4), sendingAt: daysAgo(4), sentAt: daysAgo(4),
      deliveredAt: null, openedAt: null, clickedAt: null, bouncedAt: null, complainedAt: null,
      unsubscribedAt: null, failedAt: null,
    } as any);

    // The due step is visible as exactly one operator task.
    await materializeDueSteps();
    const task = (await allTasks()).find((t) => t.sourceStepId === s2.id)!;
    expect(task.status).toBe("open");

    // The operator sends it deliberately.
    const res = await sendFollowUpAction(lead.id);
    expect(res.outcome).toBe("sent");
    expect(sends).toHaveLength(1);

    // The authoritative step is now sent, and the ledger records both touches.
    expect((await getStep(s2.id))!.sentAt).toBeTruthy();
    expect((await emailSendsForLead(lead.id)).filter((s) => s.sentAt)).toHaveLength(2);

    // Completing the task and re-materializing leaves no open work and creates nothing new.
    await completeTaskAction(task.id);
    expect((await getTask(task.id))!.status).toBe("done");

    const after = await materializeDueSteps();
    expect(after.created).toBe(0);
    expect((await allTasks()).filter((t) => t.leadId === lead.id && t.status === "open")).toHaveLength(0);
  });
});

describe("22. existing queue behaviour is unchanged by the projection", () => {
  beforeEach(() => __resetStoreForTests());

  it("ordinary tasks carry no step identity and are untouched by materialization", async () => {
    const { insertTask } = await import("../repo");
    const lead = await seedLead({ businessName: "Plain Co", publicEmail: null, phone: "(213) 555-0100" });
    await insertTask({ leadId: lead.id, type: "call", title: "call", dueAt: daysAgo(0), status: "open", priority: 60, snoozedUntil: null });

    const before = await allTasks();
    const s = await materializeDueSteps();
    const after = await allTasks();

    expect(s.created).toBe(0);
    expect(s.reconciledStale).toBe(0);
    expect(after).toHaveLength(before.length);
    expect(after[0].sourceStepId).toBeNull();
    expect(after[0].status).toBe("open");
  });

  it("a projected follow-up buckets into the existing follow-up work kind", async () => {
    const { workKindForTask } = await import("../work-queue");
    const lead = await seedLead({ businessName: "Kind Co" });
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4) });
    await seedStep(plan.id, 2, { scheduledAt: daysAgo(0) });
    await materializeDueSteps();

    const task = (await allTasks()).find((t) => t.sourceStepId)!;
    expect(workKindForTask(task, (await listLeads()).find((l) => l.id === lead.id))).toBe("follow-up");
  });

  it("projected follow-ups outrank first-contact email inside the daily cap", async () => {
    const { insertTask, todaysTasks } = await import("../repo");
    const emailLead = await seedLead({ businessName: "Intro Co" });
    await insertTask({ leadId: emailLead.id, type: "review_and_send", title: "send", dueAt: daysAgo(1), status: "open", priority: 40, snoozedUntil: null });

    const lead = await seedLead({ businessName: "Warm Co" });
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4) });
    await seedStep(plan.id, 2, { scheduledAt: daysAgo(0) });
    await materializeDueSteps();

    const today = await todaysTasks(10);
    expect(today[0].type).toBe("follow_up");
  });

  it("future steps are never counted as today's work", async () => {
    const { todaysTasks } = await import("../repo");
    const lead = await seedLead({ businessName: "Later Co" });
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4) });
    await seedStep(plan.id, 2, { scheduledAt: daysAhead(4) });
    await materializeDueSteps();
    expect(await todaysTasks(10)).toHaveLength(0);
  });
});

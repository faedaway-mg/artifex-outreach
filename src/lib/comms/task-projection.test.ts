import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { __resetStoreForTests } from "../store";
import { insertLead, insertPlan, insertStep, insertTask, allTasks, updateStep, updatePlan, updateLead, getTask } from "../repo";
import { materializeDueSteps, accountSequences, describeSequenceContext, skipReasonFor } from "./task-projection";
import { makeLead } from "../test-lead";
import type { Lead, AcquisitionPlan, AcquisitionStep } from "../types";

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const daysAhead = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function seedLead(over: Partial<Lead> = {}) {
  const base = makeLead({ publicEmail: "hi@x.com", ...over });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = base;
  return insertLead(rest);
}

async function seedPlan(leadId: string, over: Partial<AcquisitionPlan> = {}) {
  return insertPlan({
    leadId, strategy: "Assisted", objective: "o", assetPackage: "Focused",
    primaryChannel: "email", secondaryChannel: "call",
    status: "active", approvalStatus: "approved",
    currentStep: 1, maxTouches: 3, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: daysAgo(4), startedAt: daysAgo(4), pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0.15,
    estimatedValueSnapshot: null, assetReadinessSnapshot: null, assetMissingSnapshot: null,
    contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
    ...over,
  } as any);
}

async function seedStep(planId: string, stepNumber: number, over: Partial<AcquisitionStep> = {}) {
  return insertStep({
    planId, stepNumber, channel: "email", delayDays: 0,
    subject: `s${stepNumber}`, content: `c${stepNumber}`, html: null,
    approvalRequired: false, approvalStatus: "approved",
    scheduledAt: null, sentAt: null, providerMessageId: null, deliveryStatus: null,
    stoppedAt: null, stopReason: null,
    ...over,
  } as any);
}

/** The canonical Assisted shape: step 1 sent, step 2 due, step 3 still ahead. */
async function seedAssistedSequence(over: Partial<Lead> = {}) {
  const lead = await seedLead({ businessName: "Wilshire Law Firm", ...over });
  const plan = await seedPlan(lead.id);
  const s1 = await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4), deliveryStatus: "sent" });
  const s2 = await seedStep(plan.id, 2, { delayDays: 4, scheduledAt: daysAgo(0) });
  const s3 = await seedStep(plan.id, 3, { delayDays: 10, scheduledAt: daysAhead(6) });
  return { lead, plan, s1, s2, s3 };
}

const openTasks = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open");

describe("task projection — due sequence steps become visible exactly once", () => {
  beforeEach(() => __resetStoreForTests());

  it("1. an approved FUTURE step does not surface before it is due", async () => {
    const lead = await seedLead();
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(1), sentAt: daysAgo(1) });
    await seedStep(plan.id, 2, { scheduledAt: daysAhead(4) });

    const s = await materializeDueSteps();
    expect(s.created).toBe(0);
    expect(s.skipped["not-yet-due"]).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(0);
  });

  it("2. a due approved unsent step creates exactly one follow-up task, dated by the STEP", async () => {
    const { lead, s2 } = await seedAssistedSequence();
    const s = await materializeDueSteps();
    expect(s.created).toBe(1);

    const open = await openTasks(lead.id);
    expect(open).toHaveLength(1);
    expect(open[0].type).toBe("follow_up");
    expect(open[0].sourceStepId).toBe(s2.id);
    expect(open[0].dueAt).toBe(s2.scheduledAt); // the step owns the date
    expect(open[0].title).toMatch(/Follow-up #1/);
  });

  it("3. re-running materialization creates no duplicate", async () => {
    const { lead } = await seedAssistedSequence();
    await materializeDueSteps();
    const second = await materializeDueSteps();
    expect(second.created).toBe(0);
    expect(second.alreadyPresent).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(1);
  });

  it("4. concurrent materialization creates no duplicate", async () => {
    const { lead } = await seedAssistedSequence();
    await Promise.all([materializeDueSteps(), materializeDueSteps(), materializeDueSteps()]);
    expect(await openTasks(lead.id)).toHaveLength(1);
  });

  it("5. a past-due step becomes visible immediately", async () => {
    const lead = await seedLead();
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(20), sentAt: daysAgo(20) });
    await seedStep(plan.id, 2, { scheduledAt: daysAgo(11) });
    await materializeDueSteps();
    expect(await openTasks(lead.id)).toHaveLength(1);
  });

  it("6. a pending-approval plan or step creates no actionable work", async () => {
    const leadA = await seedLead({ businessName: "Ivy A" });
    const planA = await seedPlan(leadA.id, { status: "prepared", approvalStatus: "pending" });
    await seedStep(planA.id, 2, { scheduledAt: daysAgo(1), approvalStatus: "pending" });

    const leadB = await seedLead({ businessName: "Ivy B" });
    const planB = await seedPlan(leadB.id);
    await seedStep(planB.id, 2, { scheduledAt: daysAgo(1), approvalStatus: "pending" });

    const s = await materializeDueSteps();
    expect(s.created).toBe(0);
    expect(await openTasks(leadA.id)).toHaveLength(0);
    expect(await openTasks(leadB.id)).toHaveLength(0);
    expect(s.skipped["plan-not-active"]).toBe(1);
    expect(s.skipped["step-not-approved"]).toBe(1);
  });

  it("7. a sent step does not retain an open task", async () => {
    const { lead, s2 } = await seedAssistedSequence();
    await materializeDueSteps();
    const [task] = await openTasks(lead.id);

    await updateStep(s2.id, { sentAt: iso(new Date()), deliveryStatus: "sent" });
    const s = await materializeDueSteps();

    expect(s.reconciledStale).toBe(1);
    expect((await getTask(task.id))!.status).toBe("done");
    expect(await openTasks(lead.id)).toHaveLength(0);
  });

  it("10. step 2 surfaces independently of step 3", async () => {
    const { lead, s2, s3 } = await seedAssistedSequence();
    await materializeDueSteps();
    let open = await openTasks(lead.id);
    expect(open).toHaveLength(1);
    expect(open[0].sourceStepId).toBe(s2.id);

    // Step 2 sent; step 3 becomes due later — one task at a time, never both.
    await updateStep(s2.id, { sentAt: iso(new Date()) });
    await updateStep(s3.id, { scheduledAt: daysAgo(0) });
    await materializeDueSteps();

    open = await openTasks(lead.id);
    expect(open).toHaveLength(1);
    expect(open[0].sourceStepId).toBe(s3.id);
    expect(open[0].title).toMatch(/Follow-up #2/);
  });
});

describe("task projection — terminal outcomes stop follow-up work", () => {
  beforeEach(() => __resetStoreForTests());

  it("11 + 12. a stopped plan (reply / not interested) closes projected work and creates none", async () => {
    const { lead, plan } = await seedAssistedSequence();
    await materializeDueSteps();
    expect(await openTasks(lead.id)).toHaveLength(1);

    // This is exactly what stopPlansForLead does on reply / opt-out.
    await updatePlan(plan.id, { status: "stopped", stopReason: "Reply received: interested" });
    const s = await materializeDueSteps();

    expect(s.reconciledStale).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(0);
    expect(s.created).toBe(0);
  });

  it("13. disqualified / closed businesses never receive follow-up tasks", async () => {
    const { lead } = await seedAssistedSequence();
    await updateLead(lead.id, { pipelineStage: "Disqualified" });
    let s = await materializeDueSteps();
    expect(s.created).toBe(0);
    // BOTH remaining steps (the due one and the future one) are withheld on the
    // lead, not on the clock — a disqualified business has no future touches.
    expect(s.skipped["lead-terminal-stage"]).toBe(2);

    await updateLead(lead.id, { pipelineStage: "Contacted", businessStatus: "CLOSED_PERMANENTLY" });
    s = await materializeDueSteps();
    expect(s.created).toBe(0);
    expect(s.skipped["lead-closed-business"]).toBe(2);
    expect(await openTasks(lead.id)).toHaveLength(0);
  });

  it("14. a cancelled step closes its projected task", async () => {
    const { lead, s2 } = await seedAssistedSequence();
    await materializeDueSteps();
    await updateStep(s2.id, { stoppedAt: iso(new Date()), stopReason: "Suppressed" });
    const s = await materializeDueSteps();
    expect(s.reconciledStale).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(0);
  });
});

describe("reconciliation — repairs drift without ever sending", () => {
  beforeEach(() => __resetStoreForTests());

  it("15. repairs a missing task for a due step", async () => {
    const { lead } = await seedAssistedSequence();
    expect(await openTasks(lead.id)).toHaveLength(0); // drifted: nothing queued
    const s = await materializeDueSteps();
    expect(s.created).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(1);
  });

  it("16. never creates a second task for a step that already has one", async () => {
    const { lead, plan, s2 } = await seedAssistedSequence();
    await insertTask({
      leadId: lead.id, type: "follow_up", title: "manual", dueAt: daysAgo(0),
      status: "open", priority: 70, snoozedUntil: null, sourcePlanId: plan.id, sourceStepId: s2.id,
    });
    const s = await materializeDueSteps();
    expect(s.created).toBe(0);
    expect(s.alreadyPresent).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(1);
  });

  it("17. dry-run reports without writing anything", async () => {
    const { lead } = await seedAssistedSequence();
    const s = await materializeDueSteps({ apply: false });
    expect(s.created).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(0); // nothing written
  });

  it("accounting reports future, due, missing, and stalled work honestly", async () => {
    const { plan, s2 } = await seedAssistedSequence();
    const stalled = await seedLead({ businessName: "Secret House of Ivy" });
    const stalledPlan = await seedPlan(stalled.id, { status: "prepared", approvalStatus: "pending" });
    await seedStep(stalledPlan.id, 1, { approvalStatus: "pending" });

    const { allPlans, allSteps } = await import("../repo");
    let a = accountSequences({ plans: await allPlans(), steps: await allSteps(), tasks: await allTasks() });
    expect(a.activePlans).toBe(1);
    expect(a.plansAwaitingApproval).toBe(1);
    expect(a.dueUnsentSteps).toBe(1);
    expect(a.futureScheduledSteps).toBe(1);
    expect(a.dueStepsMissingTask).toBe(1);

    await materializeDueSteps();
    a = accountSequences({ plans: await allPlans(), steps: await allSteps(), tasks: await allTasks() });
    expect(a.dueStepsMissingTask).toBe(0);
    expect(a.projectedOpenTasks).toBe(1);
    expect(a.staleProjectedTasks).toBe(0);
    void plan; void s2;
  });
});

describe("sequence context — what the operator sees before sending", () => {
  beforeEach(() => __resetStoreForTests());

  it("19. Wilshire's Assisted sequence reports the right follow-up number and dates", async () => {
    const { plan, s2, s3 } = await seedAssistedSequence();
    const { stepsForPlan } = await import("../repo");
    const ctx = describeSequenceContext(s2, await stepsForPlan(plan.id));

    expect(ctx.followUpNumber).toBe(1);
    expect(ctx.totalFollowUps).toBe(2);
    expect(ctx.daysSincePriorTouch).toBe(4); // day-0 intro, now day 4
    expect(ctx.nextScheduledAt).toBe(s3.scheduledAt); // day 10 still ahead
  });

  it("the last touch in a sequence reports nothing scheduled after it", async () => {
    const { plan, s2, s3 } = await seedAssistedSequence();
    const { stepsForPlan } = await import("../repo");
    await updateStep(s2.id, { sentAt: iso(new Date()) });
    const ctx = describeSequenceContext(s3, await stepsForPlan(plan.id));
    expect(ctx.followUpNumber).toBe(2);
    expect(ctx.nextScheduledAt).toBeNull();
  });
});

describe("skipReasonFor — the guard is explicit about why work is withheld", () => {
  const now = iso(new Date());
  const lead = makeLead({ businessName: "X" }) as Lead;
  const plan = { id: "p", status: "active", approvalStatus: "approved" } as AcquisitionPlan;
  const step = (over: Partial<AcquisitionStep>) => ({ id: "s", planId: "p", stepNumber: 2, channel: "email", approvalStatus: "approved", scheduledAt: daysAgo(1), sentAt: null, stoppedAt: null, ...over }) as AcquisitionStep;

  it("never projects the introduction step — it is already review_and_send", () => {
    expect(skipReasonFor(step({ stepNumber: 1 }), plan, lead, now, 0)).toBe("is-introduction-step");
  });
  it("allows a genuinely due, approved, unsent follow-up", () => {
    expect(skipReasonFor(step({}), plan, lead, now, 0)).toBeNull();
  });
  it("withholds work when the plan is not active", () => {
    expect(skipReasonFor(step({}), { ...plan, status: "stopped" } as AcquisitionPlan, lead, now, 0)).toBe("plan-not-active");
  });
});

describe("horizon — a daily tick covers the whole day without surfacing anything early", () => {
  beforeEach(() => __resetStoreForTests());

  /** A step scheduled for later TODAY, expressed relative to tonight's cutoff. */
  // Both instants are pinned to fixed hours of the CURRENT local day, so these
  // assertions hold no matter what time of day the suite actually runs.
  const atHourToday = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d; };
  const MORNING = atHourToday(8);   // when the daily cron ticks
  const EVENING = atHourToday(20);  // when the step comes due

  /** A step scheduled for later TODAY, relative to a morning tick. */
  async function seedStepDueLaterToday() {
    const lead = await seedLead({ businessName: "Later Today Co" });
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4) });
    const s2 = await seedStep(plan.id, 2, { scheduledAt: iso(EVENING) });
    return { lead, s2 };
  }

  it("the default horizon withholds a step scheduled later today", async () => {
    const { lead } = await seedStepDueLaterToday();
    const s = await materializeDueSteps({ now: MORNING });
    expect(s.created).toBe(0);
    expect(s.skipped["not-yet-due"]).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(0);
  });

  it("the end-of-day horizon surfaces it, preserving the step's own dueAt", async () => {
    const { lead, s2 } = await seedStepDueLaterToday();
    const s = await materializeDueSteps({ now: MORNING, horizon: "end-of-day" });
    expect(s.created).toBe(1);

    const [task] = await openTasks(lead.id);
    // The task inherits the step's instant — the projection never moves the date up.
    expect(task.dueAt).toBe(s2.scheduledAt);
  });

  it("the end-of-day horizon still refuses a step scheduled tomorrow", async () => {
    const lead = await seedLead({ businessName: "Tomorrow Co" });
    const plan = await seedPlan(lead.id);
    await seedStep(plan.id, 1, { scheduledAt: daysAgo(4), sentAt: daysAgo(4) });
    // Tomorrow morning — past tonight's cutoff even from an 8 AM tick.
    await seedStep(plan.id, 2, { scheduledAt: iso(new Date(MORNING.getTime() + 86_400_000)) });

    const s = await materializeDueSteps({ now: MORNING, horizon: "end-of-day" });
    expect(s.created).toBe(0);
    expect(s.skipped["not-yet-due"]).toBe(1);
    expect(await openTasks(lead.id)).toHaveLength(0);
  });

  it("a step surfaced by the end-of-day horizon is visible in today's queue", async () => {
    const { lead } = await seedStepDueLaterToday();
    const { todaysTasks } = await import("../repo");
    await materializeDueSteps({ now: MORNING, horizon: "end-of-day" });

    const today = await todaysTasks(20);
    expect(today.filter((t) => t.leadId === lead.id)).toHaveLength(1);
  });
});

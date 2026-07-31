// ─────────────────────────────────────────────────────────────────────────────
// Step → Task projection — the bridge that was missing.
//
// The acquisition plan/step system is the AUTHORITATIVE email sequence: it owns
// sequence position, planned delay, scheduled date, approval state, send state,
// and cancellation. The `email_sends` ledger is the authoritative delivery record.
//
// Neither of those is visible to the operator. Today is built from Tasks.
//
// This module projects DUE authoritative steps into operator-visible Tasks, and
// reconciles tasks back down when their step is sent, stopped, or cancelled. It
// schedules nothing and sends nothing: it only decides what the operator can SEE.
//
//   authoritative step becomes due
//     → ensure exactly one follow-up Task
//     → operator reviews and sends through the real dispatch path
//     → step + task + ledger reconcile
//
// Idempotency is a database guarantee (unique index on tasks.source_step_id),
// not a read-then-write race. Running this twice, concurrently, or after a
// partial failure converges to the same state.
//
// STEP 1 IS DELIBERATELY NOT PROJECTED. The introduction is already represented
// by the `review_and_send` task the queue creates. Projecting it too would put
// the same work in Today twice under two different names.
// ─────────────────────────────────────────────────────────────────────────────
import {
  listLeads, allTasks, updateTask, insertTaskForStepIfAbsent,
  allPlans, allSteps,
} from "../repo";
import type { AcquisitionPlan, AcquisitionStep, Lead, Task } from "../types";

/** Steps at or inside this window are materialized. Default: due now only. */
export const DEFAULT_NEAR_DUE_MINUTES = 0;

/** Pipeline stages where outreach must never continue. */
const TERMINAL_STAGES = new Set(["Won", "Lost", "Disqualified", "Closed Won", "Closed Lost", "Client"]);

export type SkipReason =
  | "plan-not-active"
  | "plan-not-approved"
  | "step-not-approved"
  | "step-already-sent"
  | "step-stopped"
  | "not-yet-due"
  | "is-introduction-step"
  | "lead-missing"
  | "lead-terminal-stage"
  | "lead-closed-business";

export interface MaterializeSummary {
  ranAt: string;
  /** Approved, unsent, unstopped email steps on active plans — the candidate set. */
  considered: number;
  created: number;
  alreadyPresent: number;
  /** Open tasks closed because their step is now sent / stopped / cancelled. */
  reconciledStale: number;
  skipped: Record<string, number>;
  /** Steps that produced a task in this run (for verification output). */
  createdTasks: Array<{ taskId: string; stepId: string; leadId: string; businessName: string; stepNumber: number; dueAt: string }>;
  staleClosed: Array<{ taskId: string; stepId: string; reason: string }>;
}

function emptySummary(ranAt: string): MaterializeSummary {
  return { ranAt, considered: 0, created: 0, alreadyPresent: 0, reconciledStale: 0, skipped: {}, createdTasks: [], staleClosed: [] };
}

/**
 * Why this step must not become operator work right now — or null if it should.
 *
 * Stop semantics are NOT re-implemented here. `stopPlansForLead` already stops
 * plans and steps on reply, opt-out, meeting booked, won, lost, do-not-contact,
 * and suppression; this reads that existing state (plan.status / step.stoppedAt)
 * rather than duplicating the rules. The lead-level checks below are a second
 * line of defence for terminal states, not a competing source of truth.
 */
export function skipReasonFor(
  step: AcquisitionStep,
  plan: AcquisitionPlan | undefined,
  lead: Lead | undefined,
  nowIso: string,
  nearDueMinutes: number,
): SkipReason | null {
  if (!plan) return "plan-not-active";
  if (plan.status !== "active") return "plan-not-active";
  if (plan.approvalStatus !== "approved") return "plan-not-approved";
  if (step.stepNumber <= 1) return "is-introduction-step";
  if (step.sentAt) return "step-already-sent";
  if (step.stoppedAt) return "step-stopped";
  if (step.approvalStatus !== "approved") return "step-not-approved";
  if (!lead) return "lead-missing";
  if (TERMINAL_STAGES.has(lead.pipelineStage)) return "lead-terminal-stage";
  if (lead.businessStatus === "CLOSED_PERMANENTLY") return "lead-closed-business";

  if (!step.scheduledAt) return "not-yet-due";
  const cutoff = new Date(new Date(nowIso).getTime() + nearDueMinutes * 60_000).toISOString();
  if (step.scheduledAt > cutoff) return "not-yet-due";
  return null;
}

/** A task is stale when its authoritative step has moved past needing operator work. */
function staleReason(step: AcquisitionStep | undefined, plan: AcquisitionPlan | undefined): string | null {
  if (!step) return "step-no-longer-exists";
  if (step.sentAt) return "step-sent";
  if (step.stoppedAt) return "step-stopped";
  if (!plan) return "plan-no-longer-exists";
  if (plan.status === "stopped") return "plan-stopped";
  return null;
}

export interface MaterializeOptions {
  now?: Date;
  nearDueMinutes?: number;
  /**
   * How far ahead a step counts as "due now".
   *   "now"        — strictly at or past its scheduled instant (the default).
   *   "end-of-day" — anything scheduled before tonight's local cutoff.
   *
   * "end-of-day" mirrors todaysTasks(), which already shows any open task with
   * dueAt <= 23:59:59.999 today. A single morning tick therefore surfaces a step
   * scheduled for 2 PM on the day it is actually due rather than the morning
   * after — and still surfaces nothing early, because the task keeps the step's
   * own dueAt and Today's existing window remains what decides visibility.
   */
  horizon?: "now" | "end-of-day";
  /** false = report what WOULD change without writing. */
  apply?: boolean;
}

/** Minutes from `now` until tonight's local cutoff — the Today queue's own edge. */
function minutesUntilEndOfDay(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return Math.max(0, (end.getTime() - now.getTime()) / 60_000);
}

/**
 * Ensure Today shows exactly the follow-up work the authoritative sequence says
 * is due — no more, no less. Creates nothing that isn't due, closes nothing that
 * is still live, and never sends an email.
 */
export async function materializeDueSteps(opts: MaterializeOptions = {}): Promise<MaterializeSummary> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const nearDueMinutes =
    opts.nearDueMinutes ??
    (opts.horizon === "end-of-day" ? minutesUntilEndOfDay(now) : DEFAULT_NEAR_DUE_MINUTES);
  const apply = opts.apply !== false;
  const summary = emptySummary(nowIso);

  const [leads, tasks, plans, steps] = await Promise.all([listLeads(), allTasks(), allPlans(), allSteps()]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const planById = new Map(plans.map((p) => [p.id, p]));
  const stepById = new Map(steps.map((s) => [s.id, s]));

  // ── 1. Reconcile DOWN: close projected tasks whose step no longer needs work ──
  // This runs first so a sent/stopped step never leaves a phantom item in Today.
  for (const task of tasks) {
    if (!task.sourceStepId || task.status !== "open") continue;
    const step = stepById.get(task.sourceStepId);
    const plan = step ? planById.get(step.planId) : undefined;
    const reason = staleReason(step, plan);
    if (!reason) continue;
    if (apply) await updateTask(task.id, { status: reason === "step-sent" ? "done" : "skipped" });
    summary.reconciledStale += 1;
    summary.staleClosed.push({ taskId: task.id, stepId: task.sourceStepId, reason });
  }

  // ── 2. Project UP: every due authoritative step gets exactly one task ────────
  const emailSteps = steps
    .filter((s) => s.channel === "email")
    .sort((a, b) => a.stepNumber - b.stepNumber);

  for (const step of emailSteps) {
    const plan = planById.get(step.planId);
    const lead = plan ? leadById.get(plan.leadId) : undefined;
    const skip = skipReasonFor(step, plan, lead, nowIso, nearDueMinutes);
    if (skip) {
      summary.skipped[skip] = (summary.skipped[skip] ?? 0) + 1;
      continue;
    }
    summary.considered += 1;

    const followUpNumber = step.stepNumber - 1;
    const title = `Follow-up #${followUpNumber} — ${lead!.businessName}`;
    if (!apply) {
      const existing = tasks.find((t) => t.sourceStepId === step.id);
      if (existing) summary.alreadyPresent += 1;
      else {
        summary.created += 1;
        summary.createdTasks.push({ taskId: "(dry-run)", stepId: step.id, leadId: lead!.id, businessName: lead!.businessName, stepNumber: step.stepNumber, dueAt: step.scheduledAt! });
      }
      continue;
    }

    const { task, created } = await insertTaskForStepIfAbsent({
      leadId: lead!.id,
      type: "follow_up",
      title,
      // The STEP owns the date. The task mirrors it; it never invents its own.
      dueAt: step.scheduledAt!,
      status: "open",
      // Follow-ups are warm relationships with a clock on them: they outrank
      // first-contact email (40) and cold calls (55-60) inside the daily cap,
      // matching the queue's existing follow-up urgency rank of 1.
      priority: 70,
      snoozedUntil: null,
      sourcePlanId: plan!.id,
      sourceStepId: step.id,
    });
    if (created) {
      summary.created += 1;
      summary.createdTasks.push({ taskId: task.id, stepId: step.id, leadId: lead!.id, businessName: lead!.businessName, stepNumber: step.stepNumber, dueAt: step.scheduledAt! });
    } else {
      summary.alreadyPresent += 1;
    }
  }

  return summary;
}

export interface SequenceContext {
  /** 1-based follow-up number (step 2 = follow-up #1). */
  followUpNumber: number;
  totalFollowUps: number;
  priorSentAt: string | null;
  daysSincePriorTouch: number | null;
  nextScheduledAt: string | null;
}

/**
 * What the operator needs to know before sending this touch: which follow-up it
 * is, when we last spoke, and what remains scheduled after it. Read from the
 * authoritative steps, never recomputed from task metadata.
 */
export function describeSequenceContext(step: AcquisitionStep, planSteps: AcquisitionStep[], now = new Date()): SequenceContext {
  const emails = planSteps.filter((s) => s.channel === "email").sort((a, b) => a.stepNumber - b.stepNumber);
  const prior = emails.filter((s) => s.stepNumber < step.stepNumber && s.sentAt).sort((a, b) => (a.sentAt! < b.sentAt! ? 1 : -1))[0];
  const next = emails.find((s) => s.stepNumber > step.stepNumber && !s.sentAt && !s.stoppedAt);
  const priorSentAt = prior?.sentAt ?? null;
  return {
    followUpNumber: step.stepNumber - 1,
    totalFollowUps: Math.max(0, emails.length - 1),
    priorSentAt,
    daysSincePriorTouch: priorSentAt ? Math.floor((now.getTime() - new Date(priorSentAt).getTime()) / 86_400_000) : null,
    nextScheduledAt: next?.scheduledAt ?? null,
  };
}

/** Accounting only — never writes. Used by the ledger line and the audit script. */
export interface SequenceAccounting {
  activePlans: number;
  plansAwaitingApproval: number;
  futureScheduledSteps: number;
  dueUnsentSteps: number;
  pastDueUnsentSteps: number;
  dueStepsMissingTask: number;
  projectedOpenTasks: number;
  staleProjectedTasks: number;
  orphanProjectedTasks: number;
}

export function accountSequences(input: {
  plans: AcquisitionPlan[];
  steps: AcquisitionStep[];
  tasks: Task[];
  now?: Date;
}): SequenceAccounting {
  const nowIso = (input.now ?? new Date()).toISOString();
  const planById = new Map(input.plans.map((p) => [p.id, p]));
  const stepById = new Map(input.steps.map((s) => [s.id, s]));
  const taskByStep = new Map(input.tasks.filter((t) => t.sourceStepId).map((t) => [t.sourceStepId!, t]));

  const out: SequenceAccounting = {
    activePlans: input.plans.filter((p) => p.status === "active").length,
    plansAwaitingApproval: input.plans.filter((p) => p.status === "prepared" && p.approvalStatus !== "approved").length,
    futureScheduledSteps: 0, dueUnsentSteps: 0, pastDueUnsentSteps: 0, dueStepsMissingTask: 0,
    projectedOpenTasks: input.tasks.filter((t) => t.sourceStepId && t.status === "open").length,
    staleProjectedTasks: 0, orphanProjectedTasks: 0,
  };

  for (const step of input.steps) {
    if (step.channel !== "email" || step.sentAt || step.stoppedAt || step.stepNumber <= 1) continue;
    const plan = planById.get(step.planId);
    if (!plan || plan.status !== "active" || plan.approvalStatus !== "approved") continue;
    if (!step.scheduledAt) continue;
    if (step.scheduledAt > nowIso) { out.futureScheduledSteps += 1; continue; }
    out.dueUnsentSteps += 1;
    if (step.scheduledAt < nowIso) out.pastDueUnsentSteps += 1;
    const task = taskByStep.get(step.id);
    if (!task || task.status !== "open") out.dueStepsMissingTask += 1;
  }

  for (const task of input.tasks) {
    if (!task.sourceStepId || task.status !== "open") continue;
    const step = stepById.get(task.sourceStepId);
    if (!step) { out.orphanProjectedTasks += 1; continue; }
    if (step.sentAt || step.stoppedAt) out.staleProjectedTasks += 1;
  }

  return out;
}

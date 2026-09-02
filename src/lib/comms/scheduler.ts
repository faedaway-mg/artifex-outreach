// ─────────────────────────────────────────────────────────────────────────────
// Scheduling engine. Decides WHICH approved steps are due to send right now and
// executes them through the idempotent dispatcher.
//
// Responsibilities (Phase 3):
//   • execute due steps (scheduledAt reached)                 → dueStepsForSending
//   • honor business hours                                    → withinSendingWindow
//   • respect configured per-step delays                      → step.scheduledAt
//   • skip stopped / paused / completed plans                 → dueStepsForSending join
//   • retry transient failures with backoff                   → skip queued-not-yet-due
//   • log permanent failures                                  → runDueSends summary
//
// The scheduler is provider-agnostic: it never sends directly, it calls
// dispatchStep(), which owns the send-once guarantee.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, dueStepsForSending, emailSendsByStepIds, countSentEmailsBetween, getStep, getPlan, getLead, stepsForPlan, isSuppressed } from "../repo";
import { validEmail } from "../acquisition/compliance";
import { isSent } from "./state";
import { dispatchStep, type DispatchResult } from "./dispatch";
import { laDayBoundsUtc, GLOBAL_DAILY_CAP } from "../acquisition/daily-cap";
import type { SendingWindow, EmailSend } from "../types";

const DEFAULT_WINDOW: SendingWindow = { timezone: "America/Los_Angeles", startHour: 8, endHour: 17, weekdays: [1, 2, 3, 4, 5] };

/** Hour (0-23) + weekday (0=Sun) for `now` in the given IANA timezone. */
function zonedParts(now: Date, timezone: string): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(now);
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const wdStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = (parseInt(hourStr, 10) % 24) || 0;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wdStr.slice(0, 3));
  return { hour, weekday };
}

export function withinSendingWindow(now: Date, window: SendingWindow = DEFAULT_WINDOW): boolean {
  const { hour, weekday } = zonedParts(now, window.timezone);
  if (!window.weekdays.includes(weekday)) return false;
  return hour >= window.startHour && hour < window.endHour;
}

/**
 * Step ids that should be dispatched right now. Starts from the plan/step "due"
 * set, then removes anything a ledger row says must wait: a send already left the
 * system (sent-family), permanently failed, is freshly in-flight, or is a queued
 * retry whose backoff has NOT elapsed. Returned ids are safe to hand to dispatch.
 */
export async function dueStepIds(now: Date, limit = 500): Promise<string[]> {
  const nowIso = now.toISOString();
  const candidates = await dueStepsForSending(nowIso, limit);
  if (!candidates.length) return [];
  const rows = await emailSendsByStepIds(candidates);
  const byStep = new Map<string, EmailSend>();
  for (const r of rows) if (r.stepId) byStep.set(r.stepId, r);

  const out: string[] = [];
  for (const stepId of candidates) {
    const row = byStep.get(stepId);
    if (!row) { out.push(stepId); continue; } // never attempted
    if (isSent(row.status) || row.status === "failed") continue; // terminal
    if (row.status === "queued") {
      if (row.nextAttemptAt && row.nextAttemptAt > nowIso) continue; // backoff not elapsed
      out.push(stepId);
      continue;
    }
    // status === "sending": let the dispatcher decide (fresh → it skips; stale → it reclaims).
    out.push(stepId);
  }
  return out;
}

export interface SchedulerSummary {
  ranAt: string;
  windowOpen: boolean;
  considered: number;
  sent: number;
  deduped: number;
  retried: number;
  failed: number;
  skipped: number;
  capped: number;          // steps held back because the global daily cap was reached
  capDate: string;         // the LA accounting date the cap was measured on
  capBefore: number;       // prospect sends already counted on that LA date before this run
  results: DispatchResult[];
  failures: { stepId: string; reason?: string }[];
}

export interface DueSendPreview {
  ranAt: string;
  windowOpen: boolean;
  capDate: string;
  capBefore: number;
  capRemaining: number;
  wouldSend: Array<{ stepId: string; leadId: string; business: string; stepNumber: number; followUp: boolean }>;
  held: Array<{ stepId: string; reason: string }>;
}

/**
 * DRY-RUN — authenticated but STRUCTURALLY incapable of sending. Runs the exact production selection
 * (window → dueStepIds → per-step dispatch-time gates → global cap) and reports what WOULD be sent this
 * tick. Never imports the transport, never claims a ledger row, never mutates a step. Safe to run even
 * with prospect delivery live: it proves the automatic follow-up runner's decisions with zero sends.
 */
export async function previewDueSends(opts: { now?: Date; force?: boolean; limit?: number } = {}): Promise<DueSendPreview> {
  const now = opts.now ?? new Date();
  const settings = await getSettings();
  const window = settings.sendingWindow ?? DEFAULT_WINDOW;
  const windowOpen = opts.force ? true : withinSendingWindow(now, window);
  const bounds = laDayBoundsUtc(now);
  const capBefore = await countSentEmailsBetween(bounds.startIso, bounds.endIso);
  const out: DueSendPreview = { ranAt: now.toISOString(), windowOpen, capDate: bounds.date, capBefore, capRemaining: Math.max(0, GLOBAL_DAILY_CAP - capBefore), wouldSend: [], held: [] };
  if (!windowOpen) return out;
  const ids = await dueStepIds(now, opts.limit ?? 500);
  let projected = capBefore;
  for (const stepId of ids) {
    const step = await getStep(stepId);
    if (!step) { out.held.push({ stepId, reason: "step not found" }); continue; }
    const plan = await getPlan(step.planId);
    if (!plan || plan.status !== "active" || plan.approvalStatus !== "approved") { out.held.push({ stepId, reason: "plan not active/approved" }); continue; }
    const lead = await getLead(plan.leadId);
    if (!lead) { out.held.push({ stepId, reason: "lead not found" }); continue; }
    // Same gates dispatchStep enforces, evaluated read-only.
    if (step.stepNumber >= 2) {
      const planSteps = await stepsForPlan(plan.id);
      if (!planSteps.some((s) => s.channel === "email" && s.stepNumber < step.stepNumber && !!s.sentAt)) { out.held.push({ stepId, reason: "prior initial not yet provider-accepted" }); continue; }
    }
    if (!validEmail(lead.publicEmail)) { out.held.push({ stepId, reason: "invalid recipient" }); continue; }
    if (await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone })) { out.held.push({ stepId, reason: "suppressed" }); continue; }
    if (projected >= GLOBAL_DAILY_CAP) { out.held.push({ stepId, reason: "daily cap reached" }); continue; }
    projected += 1;
    out.wouldSend.push({ stepId, leadId: lead.id, business: lead.businessName, stepNumber: step.stepNumber, followUp: step.stepNumber >= 2 });
  }
  return out;
}

/**
 * Execute all due sends. Honors the business-hours window (unless `force`), runs
 * dispatches sequentially for provider-rate safety, and returns a summary with
 * permanent failures surfaced for logging/monitoring.
 */
export async function runDueSends(opts: { now?: Date; force?: boolean; limit?: number } = {}): Promise<SchedulerSummary> {
  const now = opts.now ?? new Date();
  const settings = await getSettings();
  const window = settings.sendingWindow ?? DEFAULT_WINDOW;
  const windowOpen = opts.force ? true : withinSendingWindow(now, window);

  // Global daily cap (§5): one shared ceiling of 20 prospect messages on the America/Los_Angeles accounting
  // date, across initial + follow-up + manual sends in EVERY timezone. Measured once from the ledger, then
  // enforced as we go so no path can push the LA-day total past 20 — even if `force` bypasses the window.
  const bounds = laDayBoundsUtc(now);
  const capBefore = await countSentEmailsBetween(bounds.startIso, bounds.endIso);
  const summary: SchedulerSummary = { ranAt: now.toISOString(), windowOpen, considered: 0, sent: 0, deduped: 0, retried: 0, failed: 0, skipped: 0, capped: 0, capDate: bounds.date, capBefore, results: [], failures: [] };
  if (!windowOpen) return summary;

  const ids = await dueStepIds(now, opts.limit ?? 500);
  summary.considered = ids.length;
  for (const id of ids) {
    // Hard admission check BEFORE dispatch: remaining = 20 − (already-sent-today + newly-sent-this-run).
    if (capBefore + summary.sent >= GLOBAL_DAILY_CAP) { summary.capped++; continue; }
    const r = await dispatchStep(id, { now });
    summary.results.push(r);
    switch (r.outcome) {
      case "sent": summary.sent++; break;
      case "deduped": summary.deduped++; break;
      case "retry": summary.retried++; break;
      case "failed": summary.failed++; summary.failures.push({ stepId: r.stepId, reason: r.reason }); break;
      default: summary.skipped++; break;
    }
  }
  return summary;
}

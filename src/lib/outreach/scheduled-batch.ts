// ─────────────────────────────────────────────────────────────────────────────
// One-time SCHEDULED BATCH — persist an explicit, version-bound scheduling authorization per eligible
// package, staggered across a weekday morning window, and let the runner re-verify + dispatch each
// due item at its assigned time. This is NOT review approval: only ALREADY-ELIGIBLE packages
// (emailQueueEligibility.ready) can be scheduled, and no approval record is manufactured.
//
// Durable + atomic: the binding lives in the jsonb editorial state (no migration) and every write is
// a CAS on the monotonic `rev` (commitReviewEditorial), so a refresh / web restart / runner restart
// can neither lose nor duplicate a schedule. ANY drift (recipient, evidence, revision, PDF bytes,
// template, CTA, suppression, hold) invalidates the scheduled item at the dispatch boundary — never a
// silent replacement, stale attachment, or bare email.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";
import { getLead, isSuppressed, appendAudit, commitReviewEditorial, allBusinessIntelligence, allEmailSends, getSettings } from "../repo";
import { resolveSendingWindow, nextSendingDateKey, laDateKey } from "./sending-window";
import { isBusinessHoliday, nextBusinessDayKey, addDaysKey } from "./business-calendar";
import { validEmail } from "../acquisition/compliance";
import {
  effectiveReviewFor, renderCurrentArtifact, revisionFingerprint, getEditorialState, TEMPLATE_VERSION,
  type ReviewEditorialState, type ScheduledBinding,
} from "./review-revisions";
import { emailQueueEligibility } from "./email-queue-eligibility";

// Default stagger window (weekdays 05:00–07:00 LA). The ACTIVE window is resolved from Settings by
// callers (schedulable-list / scheduleBatch) via resolveSendingWindow and passed to staggeredTimes,
// so the stagger, the gate, and the UI always agree.
export const MORNING_WINDOW = { tz: "America/Los_Angeles", startHour: 5, endHour: 7 } as const;
const digest = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** UTC offset (minutes, negative west) for America/Los_Angeles on the given calendar day — DST-correct. */
function laOffsetMinutes(y: number, m: number, d: number): number {
  const probe = new Date(Date.UTC(y, m - 1, d, 19, 0, 0)); // ~noon LA
  const laHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: MORNING_WINDOW.tz, hour: "2-digit", hour12: false }).formatToParts(probe).find((p) => p.type === "hour")!.value, 10);
  return (laHour - 19) * 60;
}

/** N evenly-staggered UTC instants across [startHour,endHour) LA on the given date (YYYY-MM-DD). */
export function staggeredTimes(dateKey: string, count: number, window: { tz: string; startHour: number; endHour: number } = MORNING_WINDOW): string[] {
  if (count <= 0) return [];
  const [y, m, d] = dateKey.split("-").map(Number);
  const offMin = laOffsetMinutes(y, m, d);
  const windowMin = (window.endHour - window.startHour) * 60;
  const step = windowMin / count; // leaves a trailing gap; no item lands at exactly endHour
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const laMinutes = window.startHour * 60 + Math.floor(i * step);
    const utcMs = Date.UTC(y, m - 1, d) + (laMinutes - offMin) * 60000;
    out.push(new Date(utcMs).toISOString());
  }
  return out;
}

export interface ScheduleResult {
  batchId: string;
  scheduled: Array<{ leadId: string; recipient: string; scheduledAt: string; pdfSha256: string; revisionId: string }>;
  removed: Array<{ leadId: string; reason: string }>; // became ineligible at confirm time
}

/** Build the exact per-message binding for an eligible lead, or a removal reason. Never sends. */
async function bindOne(leadId: string, batchId: string, scheduledAt: string, by: string, now: string): Promise<{ ok: true; binding: ScheduledBinding; recipient: string } | { ok: false; reason: string }> {
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false, reason: "no review" };
  const lead = eff.lead;
  // Only SENDABLE packages can be scheduled — NEEDS_REVIEW / INSUFFICIENT are excluded by directive.
  // (effectiveReviewFor renders with approved:true, so review.ready can't distinguish NEEDS_REVIEW;
  // gate on the raw status, which does not depend on the approval flag.)
  if (eff.review.status !== "SENDABLE") return { ok: false, reason: eff.review.status === "NEEDS_REVIEW" ? "needs review — not schedulable" : "insufficient evidence" };
  const recipientValid = validEmail(lead.publicEmail);
  const suppressed = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
  const elig = emailQueueEligibility({ review: eff.review, recipientValid, suppressed, held: !!eff.state.held });
  if (!elig.ready) return { ok: false, reason: elig.detail ?? "not eligible" };
  const art = await renderCurrentArtifact(leadId);
  if (!art) return { ok: false, reason: "could not render artifact" };
  const binding: ScheduledBinding = {
    batchId, revisionId: art.revisionId, evidenceDigest: art.manifest.evidenceDigest, pdfSha256: art.manifest.pdfSha256,
    templateVersion: TEMPLATE_VERSION, ctaUrl: eff.review.cta?.bookingUrl ?? null, recipient: lead.publicEmail!,
    subject: `Quick Review — ${lead.businessName}`, bodyDigest: digest(eff.review.openingHook ?? "" + (eff.review.whyItMatters ?? "")),
    scheduledAt, windowTz: MORNING_WINDOW.tz, by, at: now, status: "scheduled",
  };
  return { ok: true, binding, recipient: lead.publicEmail! };
}

/** Persist a scheduled binding via CAS on the editorial state (idempotent-safe, restart-safe). */
async function persistBinding(leadId: string, binding: ScheduledBinding | null): Promise<boolean> {
  const state = await getEditorialState(leadId);
  const { rev: _r, ...rest } = state;
  return (await commitReviewEditorial({
    leadId, expectedRev: state.rev ?? 0,
    nextEditorial: { ...rest, scheduled: binding } as unknown as ReviewEditorialState,
    audit: { action: binding ? "outreach.schedule.set" : "outreach.schedule.cancel", actor: binding?.by ?? "operator", targetType: "lead", targetId: leadId, meta: { batchId: binding?.batchId ?? null, scheduledAt: binding?.scheduledAt ?? null }, ip: null },
  })).ok;
}

/**
 * Schedule a one-time batch. Recomputes eligibility + renders the exact artifact for EACH lead at
 * confirm time; ineligible leads are REMOVED and reported (never fabricated to hit a target). Assigns
 * staggered times across the morning window and persists each binding atomically.
 */
export async function scheduleBatch(leadIds: string[], opts: { dateKey: string; by: string; batchId: string; now?: string; window?: { tz: string; startHour: number; endHour: number } }): Promise<ScheduleResult> {
  const now = opts.now ?? new Date().toISOString();
  const window = opts.window ?? MORNING_WINDOW;
  const result: ScheduleResult = { batchId: opts.batchId, scheduled: [], removed: [] };
  // First pass: bind eligible leads (order preserved) so we know the real count before staggering.
  const bound: Array<{ leadId: string; binding: ScheduledBinding; recipient: string }> = [];
  for (const leadId of leadIds) {
    const b = await bindOne(leadId, opts.batchId, now, opts.by, now); // scheduledAt filled in below
    if (b.ok) bound.push({ leadId, binding: b.binding, recipient: b.recipient });
    else result.removed.push({ leadId, reason: b.reason });
  }
  const times = staggeredTimes(opts.dateKey, bound.length, window);
  for (let i = 0; i < bound.length; i++) {
    const { leadId, binding, recipient } = bound[i];
    binding.scheduledAt = times[i];
    if (await persistBinding(leadId, binding)) result.scheduled.push({ leadId, recipient, scheduledAt: times[i], pdfSha256: binding.pdfSha256, revisionId: binding.revisionId });
    else result.removed.push({ leadId, reason: "another edit landed first (retry)" });
  }
  await appendAudit({ action: "outreach.schedule.batch", actor: opts.by, targetType: "campaign", targetId: opts.batchId, meta: { dateKey: opts.dateKey, scheduled: result.scheduled.length, removed: result.removed.length }, ip: null });
  return result;
}

// ── PAST-DUE RECONCILER — a missed cron tick must never leave a past timestamp shown as future work ────
export interface ScheduledReconcileResult {
  ranAt: string;
  pastDue: number;
  alreadySent: Array<{ leadId: string; providerId: string | null }>;
  rescheduled: Array<{ leadId: string; from: string; to: string }>;
  terminated: Array<{ leadId: string; reason: string }>;
}

/**
 * Reconcile every PAST-DUE scheduled binding (scheduledAt <= now):
 *   • already provider-accepted in the ledger → clear the binding (it's Sent, not scheduled);
 *   • still eligible (re-verified via validateScheduled) → reschedule idempotently into the NEXT future
 *     window (staggered), preserving ledger identity + duplicate protection (never sends);
 *   • suppressed / replied / drifted / invalid → cancel the binding (terminal) with a reason.
 * Idempotent: a second run sees the rescheduled items as future and leaves them alone. apply:false = report.
 */
export async function reconcileScheduledBindings(opts: { now?: Date; apply?: boolean } = {}): Promise<ScheduledReconcileResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const apply = opts.apply !== false;
  const [all, sends, settings] = await Promise.all([listScheduledBindings(), allEmailSends(), getSettings()]);
  const pastDue = all.filter((b) => b.binding.scheduledAt <= nowIso);
  const win = resolveSendingWindow(settings);
  const window = { tz: win.timezone, startHour: win.startHour, endHour: win.endHour };
  const dateKey = nextSendingDateKey(now, win);
  const times = staggeredTimes(dateKey, pastDue.length, window);
  const result: ScheduledReconcileResult = { ranAt: nowIso, pastDue: pastDue.length, alreadySent: [], rescheduled: [], terminated: [] };

  let i = 0;
  for (const { leadId, binding } of pastDue) {
    // Provider-accepted already? Then it's Sent — clear the stale scheduled binding.
    const sent = sends.find((s) => s.leadId === leadId && (s.status === "sent" || s.status === "delivered" || !!s.sentAt));
    if (sent) { if (apply) await persistBinding(leadId, null); result.alreadySent.push({ leadId, providerId: sent.providerMessageId ?? null }); continue; }
    // Re-verify at the boundary; ineligible → terminate (Needs attention), never silently resend.
    const v = await validateScheduled(leadId, binding);
    if (!v.ok) { if (apply) await persistBinding(leadId, null); result.terminated.push({ leadId, reason: v.reason ?? "no longer eligible" }); continue; }
    // Eligible → move forward to the next future window slot (idempotent; keeps batchId + revision).
    const to = times[i++] ?? times[times.length - 1];
    const from = binding.scheduledAt;
    if (apply) await persistBinding(leadId, { ...binding, scheduledAt: to });
    result.rescheduled.push({ leadId, from, to });
  }
  if (apply && (result.rescheduled.length || result.terminated.length || result.alreadySent.length)) {
    await appendAudit({ action: "outreach.schedule.reconcile", actor: "system", targetType: "campaign", targetId: null, meta: { pastDue: result.pastDue, rescheduled: result.rescheduled.length, terminated: result.terminated.length, alreadySent: result.alreadySent.length, dateKey }, ip: null });
  }
  return result;
}

/**
 * HOLIDAY GUARD reschedule (mandate 16): move every VALID scheduled binding that lands on a configured
 * business holiday to the next business day's same-time slot, preserving batchId/revision/lineage. An
 * INVALID binding (fails the boundary re-verify — incl. the placeholder guard) is quarantined (its binding
 * cleared → the lead surfaces in Needs attention) instead of being moved. Idempotent, no duplicates, no
 * slot consumption. apply:false reports only.
 */
export async function rescheduleHolidayBindings(opts: { now?: Date; apply?: boolean } = {}): Promise<{
  examined: number; moved: Array<{ leadId: string; from: string; to: string }>; quarantined: Array<{ leadId: string; reason: string }>;
}> {
  const apply = opts.apply !== false;
  const window = resolveSendingWindow(await getSettings());
  const all = await listScheduledBindings();
  const out = { examined: 0, moved: [] as Array<{ leadId: string; from: string; to: string }>, quarantined: [] as Array<{ leadId: string; reason: string }> };
  for (const { leadId, binding } of all) {
    const laKey = laDateKey(new Date(binding.scheduledAt), window.timezone);
    if (!isBusinessHoliday(laKey)) continue;
    out.examined += 1;
    const v = await validateScheduled(leadId, binding);
    if (!v.ok) { if (apply) await persistBinding(leadId, null); out.quarantined.push({ leadId, reason: v.reason ?? "no longer eligible" }); continue; }
    const nextKey = nextBusinessDayKey(addDaysKey(laKey, 1), window.weekdays);
    const to = binding.scheduledAt.replace(/^\d{4}-\d{2}-\d{2}/, nextKey);
    if (to === binding.scheduledAt) continue; // already moved — idempotent
    if (apply) await persistBinding(leadId, { ...binding, scheduledAt: to });
    out.moved.push({ leadId, from: binding.scheduledAt, to });
  }
  if (apply && (out.moved.length || out.quarantined.length)) {
    await appendAudit({ action: "outreach.schedule.holiday-reschedule", actor: "system", targetType: "campaign", targetId: null, meta: { examined: out.examined, moved: out.moved.length, quarantined: out.quarantined.length }, ip: null });
  }
  return out;
}

/** Cancel a lead's scheduled item before dispatch (idempotent). */
export async function cancelScheduled(leadId: string): Promise<boolean> {
  const state = await getEditorialState(leadId);
  if (!state.scheduled || state.scheduled.status !== "scheduled") return false;
  return persistBinding(leadId, null);
}

/** All persisted scheduled bindings (status "scheduled"), read from the editorial state jsonb. */
export async function listScheduledBindings(): Promise<Array<{ leadId: string; binding: ScheduledBinding }>> {
  const all = await allBusinessIntelligence();
  const out: Array<{ leadId: string; binding: ScheduledBinding }> = [];
  for (const bi of all) {
    const sched = (bi as any)?.profile?.businessProfile?.reviewEditorial?.scheduled as ScheduledBinding | undefined | null;
    if (sched && sched.status === "scheduled") out.push({ leadId: bi.leadId, binding: sched });
  }
  return out;
}

/** Scheduled items whose staggered time is DUE at `now` (and within a batch's LA morning window). */
export async function dueScheduled(now: Date): Promise<Array<{ leadId: string; binding: ScheduledBinding }>> {
  const nowIso = now.toISOString();
  return (await listScheduledBindings())
    .filter((s) => s.binding.scheduledAt <= nowIso)
    .sort((a, b) => (a.binding.scheduledAt < b.binding.scheduledAt ? -1 : 1));
}

/** Re-verify a scheduled binding at the dispatch boundary. ANY drift → not ok (fail closed). */
export async function validateScheduled(leadId: string, binding: ScheduledBinding): Promise<{ ok: boolean; reason?: string }> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, reason: "lead not found" };
  if (lead.publicEmail !== binding.recipient || !validEmail(binding.recipient)) return { ok: false, reason: "recipient changed" };
  // FAIL-CLOSED integrity gate (mandate 16/17/20): placeholder/test CONTENT never dispatches. Test-PROVENANCE
  // is rejected in PRODUCTION but ALLOWED inside the explicitly-isolated Breakbot tenant (so synthetic
  // fixtures can exercise approval) — the tenant flag is never set in production.
  { const { detectPlaceholderContent, testProvenanceReason } = await import("./dispatch-integrity");
    if (process.env.BREAKBOT_TEST_TENANT !== "1") {
      const { isInternalLead } = await import("../operators/assignment");
      const tp = testProvenanceReason(lead as { source?: string | null; businessName?: string | null; test_only?: boolean }, { internal: isInternalLead(lead) });
      if (tp) return { ok: false, reason: `TEST_PROVENANCE: ${tp}` };
    }
    const ph = detectPlaceholderContent({ subject: binding.subject, businessName: lead.businessName }); if (ph) return { ok: false, reason: `PLACEHOLDER_OR_TEST_CONTENT: ${ph}` }; }
  if (await isSuppressed({ email: binding.recipient, domain: lead.websiteDomain, phone: lead.phone })) return { ok: false, reason: "recipient suppressed since scheduling" };
  const state = await getEditorialState(leadId);
  if (state.held) return { ok: false, reason: "held since scheduling" };
  if (binding.templateVersion !== TEMPLATE_VERSION) return { ok: false, reason: "template changed since scheduling" };
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false, reason: "review no longer available" };
  if (revisionFingerprint(eff.review) !== binding.revisionId) return { ok: false, reason: "content/evidence changed since scheduling" };
  if ((eff.review.cta?.bookingUrl ?? null) !== binding.ctaUrl) return { ok: false, reason: "CTA changed since scheduling" };
  return { ok: true };
}

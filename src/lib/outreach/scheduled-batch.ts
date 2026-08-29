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
import { getLead, isSuppressed, appendAudit, commitReviewEditorial, allBusinessIntelligence } from "../repo";
import { validEmail } from "../acquisition/compliance";
import {
  effectiveReviewFor, renderCurrentArtifact, revisionFingerprint, getEditorialState, TEMPLATE_VERSION,
  type ReviewEditorialState, type ScheduledBinding,
} from "./review-revisions";
import { emailQueueEligibility } from "./email-queue-eligibility";

export const MORNING_WINDOW = { tz: "America/Los_Angeles", startHour: 8, endHour: 10 } as const;
const digest = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** UTC offset (minutes, negative west) for America/Los_Angeles on the given calendar day — DST-correct. */
function laOffsetMinutes(y: number, m: number, d: number): number {
  const probe = new Date(Date.UTC(y, m - 1, d, 19, 0, 0)); // ~noon LA
  const laHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: MORNING_WINDOW.tz, hour: "2-digit", hour12: false }).formatToParts(probe).find((p) => p.type === "hour")!.value, 10);
  return (laHour - 19) * 60;
}

/** N evenly-staggered UTC instants across [startHour,endHour) LA on the given date (YYYY-MM-DD). */
export function staggeredTimes(dateKey: string, count: number, window = MORNING_WINDOW): string[] {
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
export async function scheduleBatch(leadIds: string[], opts: { dateKey: string; by: string; batchId: string; now?: string }): Promise<ScheduleResult> {
  const now = opts.now ?? new Date().toISOString();
  const result: ScheduleResult = { batchId: opts.batchId, scheduled: [], removed: [] };
  // First pass: bind eligible leads (order preserved) so we know the real count before staggering.
  const bound: Array<{ leadId: string; binding: ScheduledBinding; recipient: string }> = [];
  for (const leadId of leadIds) {
    const b = await bindOne(leadId, opts.batchId, now, opts.by, now); // scheduledAt filled in below
    if (b.ok) bound.push({ leadId, binding: b.binding, recipient: b.recipient });
    else result.removed.push({ leadId, reason: b.reason });
  }
  const times = staggeredTimes(opts.dateKey, bound.length);
  for (let i = 0; i < bound.length; i++) {
    const { leadId, binding, recipient } = bound[i];
    binding.scheduledAt = times[i];
    if (await persistBinding(leadId, binding)) result.scheduled.push({ leadId, recipient, scheduledAt: times[i], pdfSha256: binding.pdfSha256, revisionId: binding.revisionId });
    else result.removed.push({ leadId, reason: "another edit landed first (retry)" });
  }
  await appendAudit({ action: "outreach.schedule.batch", actor: opts.by, targetType: "campaign", targetId: opts.batchId, meta: { dateKey: opts.dateKey, scheduled: result.scheduled.length, removed: result.removed.length }, ip: null });
  return result;
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

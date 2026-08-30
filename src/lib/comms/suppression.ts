// ─────────────────────────────────────────────────────────────────────────────
// Global suppression + cascade (Phases 4–5). Extends the existing suppressions registry (email match)
// with canonical states + a cascade that, on opt-out, cancels every scheduled-but-undispatched message
// and pending follow-up for that address and audits it. Idempotent + race-safe (repeat opt-outs, or an
// opt-out arriving before/after scheduling, converge on the same suppressed state).
//
// No migration: the canonical state + source + token version are encoded in the existing `reason`
// field (isSuppressed matches on email, unaffected). A real status column is an additive migration
// deferred until deploy is unblocked.
// ─────────────────────────────────────────────────────────────────────────────
import { addSuppression, isSuppressed, findLeadByEmail, appendAudit } from "../repo";
import { stopPlansForLead } from "../acquisition/stop";
import { cancelScheduled } from "../outreach/scheduled-batch";
import { normalizeEmail } from "./unsubscribe-token";

export const SUPPRESSION_STATES = ["UNSUBSCRIBED", "DO_NOT_CONTACT", "SUPPRESSED"] as const;
export type SuppressionState = (typeof SUPPRESSION_STATES)[number];

export interface SuppressInput {
  email: string;
  leadId?: string | null;
  status: SuppressionState;
  source: string;            // e.g. "one-click", "reply", "hard-bounce", "operator"
  reason?: string;
  tokenVersion?: number;
  actor?: string;
}
export interface CascadeResult { email: string; alreadySuppressed: boolean; scheduledCancelled: boolean; plansStopped: number; }

/** Encode the canonical state + provenance into the reason field (no schema change). */
function encodeReason(i: SuppressInput): string {
  return `${i.status}|src:${i.source}${i.tokenVersion != null ? `|tv:${i.tokenVersion}` : ""}${i.reason ? `|${i.reason.slice(0, 160)}` : ""}`;
}

/**
 * Permanently, globally suppress an address and cascade-cancel its pending work. Safe to call
 * repeatedly. Suppression is by NORMALIZED EMAIL, so it holds for every lead sharing that address and
 * every future outreach path (the email match is the authoritative gate).
 */
export async function suppressAndCascade(input: SuppressInput): Promise<CascadeResult> {
  const email = normalizeEmail(input.email);
  const already = await isSuppressed({ email });
  if (!already) {
    await addSuppression({ email, domain: null, phone: null, reason: encodeReason(input) });
  }
  // Cascade (run regardless — catches an opt-out that races a just-created schedule/follow-up).
  const leadId = input.leadId ?? (await findLeadByEmail(email))?.id ?? null;
  let scheduledCancelled = false;
  let plansStopped = 0;
  if (leadId) {
    scheduledCancelled = await cancelScheduled(leadId);                // clears any scheduled binding
    plansStopped = await stopPlansForLead(leadId, `suppressed: ${input.status}`); // stops follow-ups/plans
  }
  await appendAudit({ action: "outreach.suppress.cascade", actor: input.actor ?? "system", targetType: "email", targetId: email, meta: { status: input.status, source: input.source, alreadySuppressed: already, scheduledCancelled, plansStopped, leadId }, ip: null });
  return { email, alreadySuppressed: already, scheduledCancelled, plansStopped };
}

/** Authoritative final-boundary check: is this address suppressed RIGHT NOW? (email-normalized) */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  return isSuppressed({ email: normalizeEmail(email) });
}

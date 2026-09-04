// ─────────────────────────────────────────────────────────────────────────────
// BOUNDED DEEP-RECAPTURE STATE MACHINE (mandate part 5). "Being reanalyzed" can NEVER persist forever.
// Every recapture attempt for a company finishes in exactly one bounded outcome, and each attempt is
// recorded append-only (audit log) so the loop is idempotent, resumable, and inspectable:
//
//   VOICEOVER_READY        — the full chain rebuilt; terminal success.
//   AUTOMATICALLY_EXCLUDED  — evidence is genuinely insufficient after max attempts; terminal.
//   RETRY_SCHEDULED         — recoverable this round; a concrete next-attempt time is set (backoff).
//   NEEDS_ATTENTION         — a genuine human-only condition (repeated crawl crash); terminal for the loop.
//
// We store, per attempt: attempt#, timestamp, outcome, reason, and (for RETRY_SCHEDULED) nextAttemptAt.
// The current state for a lead is the LATEST record plus the attempt count. Persistence reuses the same
// append-only audit primitive the rest of the system uses; this file owns the shape + the transition math.
// ─────────────────────────────────────────────────────────────────────────────
import { appendAudit, listAudit } from "../repo";

export const RECAPTURE_ACTION = "prospect.recapture";
export const MAX_RECAPTURE_ATTEMPTS = 3;

export type RecaptureOutcome =
  | "VOICEOVER_READY"
  | "AUTOMATICALLY_EXCLUDED"
  | "RETRY_SCHEDULED"
  | "NEEDS_ATTENTION";

/** A terminal outcome ends the loop for this lead until its underlying situation materially changes. */
export function isTerminalOutcome(o: RecaptureOutcome | null | undefined): boolean {
  return o === "VOICEOVER_READY" || o === "AUTOMATICALLY_EXCLUDED" || o === "NEEDS_ATTENTION";
}

export interface RecaptureAttemptRecord {
  leadId: string;
  attempt: number;            // 1-based attempt number this record represents
  at: string;                 // ISO timestamp of this attempt
  outcome: RecaptureOutcome;
  reason: string;             // specific, human-readable ("narration:consequence_not_explained", ...)
  nextAttemptAt: string | null; // set ONLY for RETRY_SCHEDULED
  finding?: string | null;    // the observed finding used (when one was produced)
}

export interface RecaptureState {
  leadId: string;
  attempts: number;           // how many attempts have been recorded
  lastOutcome: RecaptureOutcome | null;
  lastReason: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  terminal: boolean;
}

/** Exponential-ish backoff between recoverable attempts (attempt = the number that JUST failed). */
export function recaptureBackoffMs(attempt: number): number {
  const HOUR = 3600_000;
  if (attempt <= 1) return 6 * HOUR;
  if (attempt === 2) return 24 * HOUR;
  return 72 * HOUR;
}
export function nextRecaptureAt(now: Date, attempt: number): string {
  return new Date(now.getTime() + recaptureBackoffMs(attempt)).toISOString();
}

/** Decide the bounded outcome of an attempt from (success?, the attempt number, whether the failure is a
 *  human-only condition). This is the pure heart of the machine — fully unit-testable. */
export function decideOutcome(input: {
  attempt: number;            // 1-based number of THIS attempt
  succeeded: boolean;
  humanOnly?: boolean;        // a genuine human-only condition (e.g. repeated unexpected crash)
  now: Date;
}): { outcome: RecaptureOutcome; nextAttemptAt: string | null } {
  if (input.succeeded) return { outcome: "VOICEOVER_READY", nextAttemptAt: null };
  const exhausted = input.attempt >= MAX_RECAPTURE_ATTEMPTS;
  if (input.humanOnly && exhausted) return { outcome: "NEEDS_ATTENTION", nextAttemptAt: null };
  if (exhausted) return { outcome: "AUTOMATICALLY_EXCLUDED", nextAttemptAt: null };
  return { outcome: "RETRY_SCHEDULED", nextAttemptAt: nextRecaptureAt(input.now, input.attempt) };
}

type AuditRow = { action?: string; meta?: unknown; createdAt?: string };

/** Fold the append-only audit log into the current recapture state per lead (latest record wins;
 *  attempts = the highest attempt number seen). Pass a pre-fetched audit list to avoid a re-read. */
export function foldRecaptureStates(audit: AuditRow[]): Map<string, RecaptureState> {
  const byLead = new Map<string, RecaptureState>();
  // audit is recent-first (listAudit). Walk oldest→newest so "latest wins" is unambiguous and attempts count up.
  const rows = [...audit].reverse();
  for (const a of rows) {
    if (a.action !== RECAPTURE_ACTION) continue;
    const rec = (a.meta as { rec?: RecaptureAttemptRecord } | undefined)?.rec;
    if (!rec?.leadId) continue;
    const prev = byLead.get(rec.leadId);
    byLead.set(rec.leadId, {
      leadId: rec.leadId,
      attempts: Math.max(prev?.attempts ?? 0, rec.attempt),
      lastOutcome: rec.outcome,
      lastReason: rec.reason,
      lastAttemptAt: rec.at,
      nextAttemptAt: rec.outcome === "RETRY_SCHEDULED" ? rec.nextAttemptAt : null,
      terminal: isTerminalOutcome(rec.outcome),
    });
  }
  return byLead;
}

export async function readAllRecaptureStates(): Promise<Map<string, RecaptureState>> {
  const audit = await listAudit(5000);
  return foldRecaptureStates(audit as AuditRow[]);
}

/** Is a lead due for a (new) attempt right now? Terminal states are never due; RETRY_SCHEDULED is due once
 *  its nextAttemptAt passes; a lead with no state yet is due. */
export function isRecaptureDue(state: RecaptureState | undefined, now: Date): boolean {
  if (!state) return true;
  if (state.terminal) return false;
  if (state.attempts >= MAX_RECAPTURE_ATTEMPTS) return false;
  if (state.nextAttemptAt && state.nextAttemptAt > now.toISOString()) return false;
  return true;
}

/** Record one attempt (append-only). Returns the record written. */
export async function recordRecaptureAttempt(rec: RecaptureAttemptRecord): Promise<RecaptureAttemptRecord> {
  await appendAudit({
    action: RECAPTURE_ACTION,
    actor: "system",
    targetType: "lead",
    targetId: rec.leadId,
    meta: { rec } as unknown as Record<string, unknown>,
    ip: null,
  });
  return rec;
}

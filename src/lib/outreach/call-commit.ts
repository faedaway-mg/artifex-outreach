// ─────────────────────────────────────────────────────────────────────────────
// Turning a tapped-through call into the one write it deserves.
//
// The conversation engine (call-conversation.ts) is a draft: pure, reversible, and
// invisible to the database. This module is the bridge from that draft to the
// existing nine-outcome save — the moment the operator commits.
//
// It is kept pure and separate from the server action for two reasons. The mapping
// from a path to an outcome is the part most likely to be wrong, and it is exactly
// the part a server action makes hard to test. And the idempotency check — "have we
// already recorded this call?" — is a predicate over rows, not a database concern;
// an operator mid-call taps Save twice on a slow connection, and that must produce
// one record, not two.
// ─────────────────────────────────────────────────────────────────────────────
import type { CallOutcomeInput } from "./call-outcome";
import {
  deriveOutcome,
  deriveIntelligence,
  describePath,
  type CallSession,
  type CallEvent,
} from "./call-conversation";

/** The audit action under which a committed call session is recorded. */
export const CALL_SESSION_AUDIT_ACTION = "lead.call-session.recorded";

/**
 * The outcome input a session commits as.
 *
 * `followUpAt` is deliberately NOT derived here — a session records what happened,
 * not what the clock says. The caller supplies scheduling.
 */
export function outcomeInputFromSession(
  s: CallSession,
  extra: { followUpAt?: string } = {},
): CallOutcomeInput {
  const d = deriveOutcome(s);
  const c = s.captured;

  // The committed note reads like the call actually went, followed by whatever the
  // operator typed in their own words.
  const notes = [describePath(s.path), c.notes?.trim()].filter(Boolean).join(" · ");

  return {
    outcome: d.outcome,
    reachedRole: c.contactRole ?? null,
    ...(c.contactName?.trim() ? { contactName: c.contactName.trim() } : {}),
    // An address is passed through on every outcome that can hold one; whether it
    // becomes a SEND ROUTE is decided by the outcome (permission), never here.
    ...(d.email ? { verifiedEmail: d.email } : {}),
    ...(c.callbackWindow?.trim() ? { bestTime: c.callbackWindow.trim() } : {}),
    ...(extra.followUpAt ? { followUpAt: extra.followUpAt } : {}),
    voicemail: d.voicemail,
    ...(notes ? { notes } : {}),
  };
}

/** The structured record of the call — the part a free-text note could never hold. */
export function callSessionAuditMeta(s: CallSession): Record<string, unknown> {
  const d = deriveOutcome(s);
  const i = deriveIntelligence(s);
  return {
    sessionId: s.sessionId,
    outcome: d.outcome,
    because: d.because,
    permission: i.permission,
    emailKind: i.emailKind,
    voicemail: d.voicemail,
    path: s.path as CallEvent[],
    pathLabel: describePath(s.path),
    facts: i.facts,
    language: i.language,
    transfer: i.transfer,
    callbackWindow: i.callbackWindow,
    interests: i.interests,
  };
}

/** An audit row, narrowed to only what the idempotency check reads. */
export interface CommittedSessionRow {
  action: string;
  meta: unknown;
}

/**
 * Has this exact call already been recorded?
 *
 * The session id is generated once when the call starts and never changes, so a
 * double-tapped Save, a retried request, or a back-button resubmit all carry the
 * same key — and find the record they would otherwise duplicate.
 */
export function findCommittedSession<T extends CommittedSessionRow>(rows: T[], sessionId: string): T | null {
  if (!sessionId) return null;
  return rows.find((r) => r.action === CALL_SESSION_AUDIT_ACTION && (r.meta as { sessionId?: string } | null)?.sessionId === sessionId) ?? null;
}

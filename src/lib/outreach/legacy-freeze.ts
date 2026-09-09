// ─────────────────────────────────────────────────────────────────────────────
// LEGACY COLD-OUTREACH FREEZE — Quick-Cash Consolidation.
//
// Quick-Cash is now the primary pipeline of Acquisition OS. The old general
// cold-outreach engine is moved to a SECONDARY / LEGACY posture and MUST NOT send
// prospect email by default. This is a HARD, code-level, fail-closed gate that is
// FROZEN BY DEFAULT — independent of the older per-runner autosend flags
// (QR_AUTOSEND_ENABLED / COMMS_AUTOSEND_ENABLED) and of the reversible operational
// pause (outreachPausedNow). Any one of those already stops sends; this makes
// "frozen" the *default* so no future config drift can silently resume cold email.
//
// Reversible: an operator can explicitly re-enable the legacy path (edge cases,
// warm/reply-driven work, larger engagements) by setting LEGACY_COLD_OUTREACH_ENABLED=1.
//
// SCOPE: this gate applies ONLY to real COLD_OUTREACH. It never touches customer /
// reply / transactional comms (those route to the transactional provider, not the
// cold-compliant path) and it leaves INTERNAL_TEST (pinned to COMMS_TEST_RECIPIENT)
// working so controlled, no-prospect send proofs remain possible.
// ─────────────────────────────────────────────────────────────────────────────

export const LEGACY_ENABLE_ENV = "LEGACY_COLD_OUTREACH_ENABLED";

/** True (frozen) by default. Only an explicit "1" re-enables the legacy cold path. */
export function legacyColdOutreachFrozen(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LEGACY_ENABLE_ENV] !== "1";
}

export const LEGACY_FROZEN_REASON =
  "Legacy cold outreach is frozen (Quick-Cash Consolidation). The old acquisition path no longer " +
  "sends prospect email by default. Set LEGACY_COLD_OUTREACH_ENABLED=1 to explicitly re-enable it.";

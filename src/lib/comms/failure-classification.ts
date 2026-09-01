// ─────────────────────────────────────────────────────────────────────────────
// Failure classification — the ONE place that decides whether a `failed` email_sends row is
// GENUINELY terminal (a recipient/provider hard-stop that must never be retried) or a
// CONFIGURATION / TRANSIENT / INTERNAL failure that became "failed" only because of the state of
// the system at the time (sending disabled, provider unconfigured, a missing postal address for the
// footer, a temporary 5xx/429, an expired key, a not-yet-ready review). The dispatcher, the operator
// "Try send again" path, and the UI all read this so they agree on what a failure MEANS.
//
// Guiding rule: a message that NEVER reached the provider (no provider message id, not an ambiguous
// post-submit fault) delivered nothing — so once the underlying condition is corrected it is always
// safe to try again. Only a genuine hard-stop, or a message the provider may already have accepted,
// is permanent. Pure/dependency-free.
// ─────────────────────────────────────────────────────────────────────────────
import type { EmailSendStatus } from "../types";
import { SENT_STATES } from "./state";

/** A minimal view of an email_sends row — everything classification needs, nothing it doesn't. */
export interface SendRowLike {
  status: EmailSendStatus | string;
  lastErrorCode?: string | null;
  lastError?: string | null;
  providerMessageId?: string | null;
  failedAt?: string | null;
  attempts?: number | null;
}

// Codes that mean "the message could not be assembled or submitted because of how the SYSTEM was
// configured / a transient fault / an account-level problem — NOT because of the recipient". Once the
// condition is fixed, an operator retry is safe (nothing was ever delivered). Both spellings of the
// route-refusal code are listed because the two transport layers historically emit different casing.
export const RETRYABLE_AFTER_CORRECTION: ReadonlySet<string> = new Set([
  "compliance_incomplete", // footer couldn't assemble (e.g. missing postal address / unsubscribe secret)
  "route_refused",
  "route-refused",
  "recipient-gate",        // prospect delivery was disabled at the time
  "unconfigured",          // no sending provider configured at the time
  "review_not_ready",      // the Quick Review wasn't delivery-ready yet
  "server",                // provider 5xx
  "rate_limited",          // provider 429
  "network",               // pre-submit network fault (post-submit → ambiguous, handled separately)
  "timeout",
  "auth",                  // account-level: expired/invalid key — not the message's fault
  "internal",
]);

// Codes that are GENUINELY terminal: a recipient-specific or provider hard-stop, or a post-submit
// ambiguous fault where the provider MAY already have accepted the message (never blindly resend).
export const TERMINAL_FAILURE: ReadonlySet<string> = new Set([
  "suppressed",
  "unsubscribed",
  "invalid-recipient",
  "validation",       // provider 4xx: the message/address was rejected
  "client",           // unknown provider 4xx — do not hammer
  "ambiguous_submit", // provider may have accepted — reconcile before any retry
  "hard_bounce",
  "bounced",
  "complaint",
  "complained",
]);

/** True when the provider was (or may have been) contacted — the message might already be out there. */
export function resendWasContacted(row: SendRowLike): boolean {
  if (row.providerMessageId) return true;
  if (SENT_STATES.includes(row.status as EmailSendStatus)) return true;
  if ((row.lastErrorCode ?? "") === "ambiguous_submit") return true; // uncertain — treat as contacted
  return false;
}

export interface RetryEligibility {
  /** Whether the row is a `failed` row this module applies to. */
  applicable: boolean;
  /** Safe for an OPERATOR-initiated retry (never for the automatic scheduler). */
  retryable: boolean;
  /** A genuine hard-stop that must never be resent. */
  terminal: boolean;
  /** Whether the provider was (or may have been) contacted for this attempt. */
  resendContacted: boolean;
  /** Coarse class for messaging. */
  kind: "config" | "transient" | "terminal" | "sent" | "not-failed";
}

/**
 * Classify a `failed` row for retry. Only ever grants retryability to an operator action, and only
 * when the provider was never (certainly) contacted AND the code is not a genuine hard-stop. An
 * unknown code on a message that never reached the provider is treated as retryable (nothing was
 * delivered) — fail OPEN toward "let the operator try again", fail CLOSED on anything terminal.
 */
export function retryEligibility(row: SendRowLike): RetryEligibility {
  if (SENT_STATES.includes(row.status as EmailSendStatus)) {
    return { applicable: false, retryable: false, terminal: true, resendContacted: true, kind: "sent" };
  }
  if (row.status !== "failed") {
    return { applicable: false, retryable: false, terminal: false, resendContacted: false, kind: "not-failed" };
  }
  const contacted = resendWasContacted(row);
  const code = row.lastErrorCode ?? "";
  if (contacted || TERMINAL_FAILURE.has(code)) {
    return { applicable: true, retryable: false, terminal: true, resendContacted: contacted, kind: "terminal" };
  }
  // Retryable-after-correction (explicit) OR unknown-but-never-delivered (safe to retry).
  const isConfig = code === "compliance_incomplete" || code === "unconfigured" || code === "recipient-gate" || code === "route_refused" || code === "route-refused" || code === "review_not_ready";
  return { applicable: true, retryable: true, terminal: false, resendContacted: false, kind: isConfig ? "config" : "transient" };
}

// ── UI-facing description ─────────────────────────────────────────────────────
export interface SendStateView {
  /** Present only when there is a prior FAILED attempt worth surfacing. */
  status: "failed";
  code: string | null;
  /** Short, safe, specific headline (no secrets, no stack traces). */
  headline: string;
  /** One-line detail explaining the state and what unblocks it. */
  detail: string;
  /** Whether the provider was (or may have been) contacted. */
  resendContacted: boolean;
  /** Whether an operator "Try send again" can currently reach the provider. */
  retryAvailable: boolean;
  /** ISO timestamp of the failure, if recorded. */
  failedAt: string | null;
}

const HEADLINES: Record<string, { headline: string; detail: string }> = {
  compliance_incomplete: {
    headline: "Not sent — the message couldn't be assembled compliantly",
    detail: "A required footer detail (the business mailing address) was missing. Add it in Settings, then retry.",
  },
  unconfigured: { headline: "Not sent — sending wasn't configured at the time", detail: "The sending provider is set up now. Ready to retry." },
  "recipient-gate": { headline: "Not sent — prospect delivery was disabled at the time", detail: "Prospect delivery is enabled now. Ready to retry." },
  route_refused: { headline: "Not sent — this message's route wasn't permitted at the time", detail: "Ready to retry." },
  "route-refused": { headline: "Not sent — this message's route wasn't permitted at the time", detail: "Ready to retry." },
  review_not_ready: { headline: "Not sent — the Quick Review wasn't delivery-ready", detail: "Prepare/approve the review, then retry." },
  server: { headline: "Not sent — a temporary provider issue", detail: "The provider returned a temporary error. Ready to retry." },
  rate_limited: { headline: "Not sent — the provider was rate-limited", detail: "Ready to retry." },
  network: { headline: "Not sent — a temporary network issue", detail: "Ready to retry." },
  timeout: { headline: "Not sent — the request timed out", detail: "Ready to retry." },
  auth: { headline: "Not sent — the sending key was invalid at the time", detail: "The key is valid now. Ready to retry." },
  internal: { headline: "Not sent — an internal error interrupted the send", detail: "Ready to retry." },
  suppressed: { headline: "Cannot send — this recipient is suppressed", detail: "The address is on the suppression list and will not receive outreach." },
  unsubscribed: { headline: "Cannot send — this recipient unsubscribed", detail: "They opted out; outreach is permanently stopped for this address." },
  "invalid-recipient": { headline: "Cannot send — the address is invalid", detail: "The recipient address was rejected as invalid." },
  validation: { headline: "Cannot send — the provider rejected the address", detail: "The provider confirmed the address is invalid or not acceptable." },
  client: { headline: "Cannot send — the provider rejected the message", detail: "The provider rejected the request and it should not be retried as-is." },
  ambiguous_submit: {
    headline: "Not resent — the provider's response was uncertain",
    detail: "The provider may already have accepted it. Reconcile the mailbox before any retry to avoid a duplicate.",
  },
  hard_bounce: { headline: "Cannot send — the address hard-bounced", detail: "Delivery permanently failed for this address." },
  bounced: { headline: "Cannot send — the address bounced", detail: "Delivery failed for this address." },
  complaint: { headline: "Cannot send — a spam complaint was recorded", detail: "Outreach is stopped for this address." },
  complained: { headline: "Cannot send — a spam complaint was recorded", detail: "Outreach is stopped for this address." },
};

/**
 * Describe the latest send row for the operator UI, or null when there is nothing worth surfacing
 * (no prior attempt, or the attempt already succeeded). Never leaks a raw provider error or secret.
 */
export function describeSendState(row: SendRowLike | null | undefined): SendStateView | null {
  if (!row || row.status !== "failed") return null;
  const elig = retryEligibility(row);
  const code = row.lastErrorCode ?? null;
  const canned = (code && HEADLINES[code]) || (elig.retryable
    ? { headline: "Not sent — a temporary issue interrupted the send", detail: "Ready to retry." }
    : { headline: "Cannot send", detail: "This send is blocked and should not be retried as-is." });
  return {
    status: "failed",
    code,
    headline: canned.headline,
    detail: canned.detail,
    resendContacted: elig.resendContacted,
    retryAvailable: elig.retryable,
    failedAt: row.failedAt ?? null,
  };
}

/** The concise DispatchResult.reason for a terminal (non-retryable) failed row — specific, never generic. */
export function terminalFailureReason(row: SendRowLike): string {
  const code = row.lastErrorCode ?? "";
  const canned = HEADLINES[code];
  if (canned) return canned.detail ? `${canned.headline}. ${canned.detail}` : canned.headline;
  if (resendWasContacted(row)) return "Already handed to the provider — not resent (reconcile before any retry).";
  return row.lastError ? `Previously failed: ${row.lastError}` : "Previously failed (not retryable as-is).";
}

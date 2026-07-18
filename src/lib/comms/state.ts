// Communication lifecycle state groups + retry policy. Shared by the dispatcher,
// scheduler, webhook processor, and monitoring so they all agree on what each
// status means. Pure/dependency-free.
import type { EmailSendStatus } from "../types";

// A send has successfully LEFT our system (Resend accepted it). All post-send
// delivery events imply this too, so any of these means "do not send again".
export const SENT_STATES: readonly EmailSendStatus[] = ["sent", "delivered", "opened", "clicked", "bounced", "complained", "unsubscribed"];

// No further send should ever happen from these (sent-family or permanently failed).
export const TERMINAL_STATES: readonly EmailSendStatus[] = [...SENT_STATES, "failed"];

export const isSent = (s: EmailSendStatus): boolean => SENT_STATES.includes(s);
export const isTerminal = (s: EmailSendStatus): boolean => TERMINAL_STATES.includes(s);

// Retry policy (Phase 9). Transient failures re-queue with exponential backoff up
// to MAX_ATTEMPTS; then the send is marked failed (permanent).
export const MAX_ATTEMPTS = Number(process.env.COMMS_MAX_ATTEMPTS ?? 5);

/** Backoff before the Nth retry (attempt is the count already made). 1m,2m,4m,8m… capped at 6h. */
export function backoffMs(attempts: number): number {
  const base = 60_000; // 1 minute
  return Math.min(base * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000);
}

// A row stuck in "sending" longer than this is assumed to be from a crashed
// worker (e.g. Railway restart mid-send) and may be reclaimed.
export const STUCK_SENDING_MS = Number(process.env.COMMS_STUCK_MS ?? 5 * 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Honest "Emails to send" gate. A lead belongs in the READY queue only when its whole package is
// prepared and eligible — a valid unsuppressed recipient, a content-SENDABLE (or operator-approved
// one-finding) review, and a booking CTA. Everything else goes to "Not ready" WITH A SPECIFIC REASON,
// never shown as ready-then-blocked. Being in the database (or merely having an email) is not enough.
//
// Pure over supplied inputs so the rule is unit-testable and the same predicate governs the queue
// filter and the card. Evidence thresholds are preserved — this only surfaces them honestly.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickReview } from "./quick-review";

export type NotReadyReason =
  | "no-recipient" | "suppressed" | "held" | "no-review" | "insufficient-evidence"
  | "needs-review" | "not-delivery-ready" | "no-cta";

export interface EmailQueueEligibility {
  ready: boolean;
  reason?: NotReadyReason;
  /** Operator-facing sentence for the "Not ready" view. */
  detail?: string;
}

export function emailQueueEligibility(input: {
  review: QuickReview | null;
  recipientValid: boolean;
  suppressed: boolean;
  held?: boolean;
}): EmailQueueEligibility {
  if (!input.recipientValid) return { ready: false, reason: "no-recipient", detail: "No valid business email on file." };
  if (input.suppressed) return { ready: false, reason: "suppressed", detail: "Recipient is suppressed (opt-out / bounce)." };
  if (input.held) return { ready: false, reason: "held", detail: "On hold by the operator." };
  if (!input.review) return { ready: false, reason: "no-review", detail: "No Quick Review generated yet." };
  const st = input.review.status;
  if (st === "INSUFFICIENT_EVIDENCE") return { ready: false, reason: "insufficient-evidence", detail: "No supported finding yet — nothing evidence-backed to send." };
  if (st === "NEEDS_REVIEW" && !input.review.ready) return { ready: false, reason: "needs-review", detail: "One finding — review and approve before it's send-ready." };
  if (!input.review.ready) return { ready: false, reason: "not-delivery-ready", detail: "Review didn't pass the delivery checks (evidence/editorial/render)." };
  if (!input.review.cta?.bookingUrl) return { ready: false, reason: "no-cta", detail: "Missing the booking call-to-action." };
  return { ready: true };
}

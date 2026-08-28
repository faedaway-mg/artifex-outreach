// ─────────────────────────────────────────────────────────────────────────────
// Pure reducer mapping Stripe invoice/charge events onto our invoice state. No IO.
//
// Money state is NOT globally forward-only: a later return, refund, or dispute is
// applied WITHOUT erasing that the invoice was paid. Out-of-order events that would
// regress an illegal transition are recorded (by the caller's event log) but do not
// mutate state. Duplicates are a no-op. A browser redirect is never an input here —
// only signature-verified provider events reach this reducer.
// ─────────────────────────────────────────────────────────────────────────────
import type { Invoice } from "../types";
import { canTransition, type InvoiceState } from "../billing/invoice";

export interface InvoiceEvent {
  type: string; // Stripe event type, e.g. "invoice.paid"
  occurredAt: string;
  /** For refunds: cumulative amount refunded on the charge, in minor units. */
  amountRefundedCents?: number;
  /** For dispute.closed: "won" | "lost". */
  disputeStatus?: string;
}

export type EventOutcome = "applied" | "duplicate" | "ignored" | "unmapped";

export interface ApplyResult {
  outcome: EventOutcome;
  nextState: InvoiceState;
  patch: Partial<Invoice>;
}

/** Stripe event type → intended target state (null = unmapped/ignored). */
export function mapEventToState(type: string, ev?: InvoiceEvent): InvoiceState | null {
  switch (type) {
    case "invoice.finalized":
      return "issued";
    case "invoice.payment_processing":
      return "processing";
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return "paid";
    case "invoice.payment_failed":
      return "failed";
    case "invoice.voided":
      return "void";
    case "invoice.marked_uncollectible":
      return "uncollectible";
    case "charge.refunded":
      return "refunded"; // refined to partially_refunded below when amount < total
    case "charge.dispute.created":
      return "disputed";
    case "charge.dispute.closed":
      return ev?.disputeStatus === "won" ? "paid" : "refunded";
    default:
      return null;
  }
}

export function applyInvoiceEvent(invoice: Invoice, ev: InvoiceEvent): ApplyResult {
  const from = invoice.state as InvoiceState;
  let target = mapEventToState(ev.type, ev);
  if (target === null) return { outcome: "unmapped", nextState: from, patch: {} };

  // Refund refinement: partial vs full based on cumulative refunded amount.
  if (ev.type === "charge.refunded") {
    const refunded = ev.amountRefundedCents ?? invoice.amountCents;
    target = refunded >= invoice.amountCents ? "refunded" : "partially_refunded";
  }

  if (target === from) return { outcome: "duplicate", nextState: from, patch: {} };
  if (!canTransition(from, target)) {
    // Out-of-order / illegal regression: do NOT mutate state. The caller still logs
    // the event for the audit trail.
    return { outcome: "ignored", nextState: from, patch: {} };
  }

  const patch: Partial<Invoice> = { state: target };
  switch (target) {
    case "paid":
      patch.paidAt = ev.occurredAt;
      break;
    case "failed":
      patch.failedAt = ev.occurredAt;
      break;
    case "void":
      patch.voidedAt = ev.occurredAt;
      break;
    case "refunded":
    case "partially_refunded":
      patch.refundedAt = ev.occurredAt;
      patch.amountRefundedCents = ev.amountRefundedCents ?? invoice.amountCents;
      break;
    case "disputed":
      patch.disputedAt = ev.occurredAt;
      break;
    case "issued":
      patch.issuedAt = ev.occurredAt;
      break;
  }
  return { outcome: "applied", nextState: target, patch };
}

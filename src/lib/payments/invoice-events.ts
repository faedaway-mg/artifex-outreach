// ─────────────────────────────────────────────────────────────────────────────
// Pure reducer mapping Stripe events onto our invoice. No IO. THREE distinct kinds
// of fact, never conflated:
//   • LIFECYCLE (invoice.*)      → the `state` field (forward-only collection path);
//   • REFUND (charge.refunded)   → amountRefundedCents (merchant returned money);
//   • DISPUTE (charge.dispute.*) → disputeStatus + amountDisputedCents.
//
// A refund and a chargeback are SEPARATE financial facts. A LOST dispute is NOT a
// refund — it is a chargeback loss, recorded as disputeStatus="lost". A won dispute
// does not "restore paid" (the invoice never left paid); it only resolves the dispute.
// None of these erase that the invoice was paid. Out-of-order/duplicate are no-ops.
// ─────────────────────────────────────────────────────────────────────────────
import type { Invoice } from "../types";
import { canTransition, type InvoiceState } from "../billing/invoice";

export interface InvoiceEvent {
  type: string; // Stripe event type, e.g. "invoice.paid"
  occurredAt: string;
  /** For refunds: cumulative amount refunded on the charge, minor units. */
  amountRefundedCents?: number;
  /** For disputes: disputed amount, minor units. */
  amountDisputedCents?: number;
  /** For dispute.closed: "won" | "lost" | "warning_closed" (+ others). */
  disputeStatus?: string;
  /** Captured from invoice.paid so later charge/dispute events resolve here. */
  chargeId?: string;
  paymentIntentId?: string;
}

export type EventOutcome = "applied" | "duplicate" | "ignored" | "unmapped";

export interface ApplyResult {
  outcome: EventOutcome;
  patch: Partial<Invoice>;
}

// LIFECYCLE events only. Refund/dispute are handled separately (they are not states).
// NOTE (verified against Stripe docs 2026-08-27): there is NO `invoice.payment_processing`
// event. An ACH/bank payment that is pending/settling is signalled by
// `payment_intent.processing` (on the PaymentIntent), which we map to "processing".
export function mapEventToState(type: string): InvoiceState | null {
  switch (type) {
    case "invoice.finalized":
      return "issued";
    case "payment_intent.processing": // ACH/bank in flight (PI-level, not invoice-level)
      return "processing";
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return "paid";
    case "invoice.payment_failed":
    case "payment_intent.payment_failed":
      return "failed";
    case "invoice.voided":
      return "void";
    case "invoice.marked_uncollectible":
      return "uncollectible";
    default:
      return null;
  }
}

function isRefund(type: string): boolean {
  return type === "charge.refunded";
}
function isDisputeOpen(type: string): boolean {
  return type === "charge.dispute.created";
}
function isDisputeClosed(type: string): boolean {
  return type === "charge.dispute.closed";
}
function isFundsWithdrawn(type: string): boolean {
  return type === "charge.dispute.funds_withdrawn";
}
function isFundsReinstated(type: string): boolean {
  return type === "charge.dispute.funds_reinstated";
}

export function applyInvoiceEvent(invoice: Invoice, ev: InvoiceEvent): ApplyResult {
  // ── LIFECYCLE ────────────────────────────────────────────────────────────
  const target = mapEventToState(ev.type);
  if (target !== null) {
    const from = invoice.state as InvoiceState;
    if (target === from) {
      // Even a duplicate paid can carry the charge/PI mapping the first one lacked.
      const patch = captureRefs(invoice, ev);
      return { outcome: Object.keys(patch).length ? "applied" : "duplicate", patch };
    }
    if (!canTransition(from, target)) return { outcome: "ignored", patch: {} };
    const patch: Partial<Invoice> = { state: target, ...captureRefs(invoice, ev) };
    if (target === "paid") patch.paidAt = ev.occurredAt;
    else if (target === "failed") patch.failedAt = ev.occurredAt;
    else if (target === "void") patch.voidedAt = ev.occurredAt;
    else if (target === "issued") patch.issuedAt = ev.occurredAt;
    return { outcome: "applied", patch };
  }

  // ── REFUND (distinct from dispute) ───────────────────────────────────────
  if (isRefund(ev.type)) {
    const refunded = ev.amountRefundedCents ?? invoice.amountCents;
    if (refunded === invoice.amountRefundedCents) return { outcome: "duplicate", patch: {} };
    return { outcome: "applied", patch: { amountRefundedCents: refunded, refundedAt: ev.occurredAt } };
  }

  // ── DISPUTE opened ───────────────────────────────────────────────────────
  if (isDisputeOpen(ev.type)) {
    // Only open from a clean state; never reopen a resolved dispute (out-of-order safe).
    if (invoice.disputeStatus !== "none") return { outcome: "duplicate", patch: {} };
    return {
      outcome: "applied",
      patch: { disputeStatus: "open", amountDisputedCents: ev.amountDisputedCents ?? invoice.amountCents, disputedAt: ev.occurredAt },
    };
  }

  // ── DISPUTE resolved — LOST is a chargeback, NOT a refund ────────────────
  if (isDisputeClosed(ev.type) || isFundsWithdrawn(ev.type) || isFundsReinstated(ev.type)) {
    let outcome: "won" | "lost" | null = null;
    if (isFundsWithdrawn(ev.type)) outcome = "lost";
    else if (isFundsReinstated(ev.type)) outcome = "won";
    else outcome = ev.disputeStatus === "won" ? "won" : ev.disputeStatus === "lost" ? "lost" : null;
    if (outcome === null) return { outcome: "ignored", patch: {} }; // e.g. warning_closed
    if (invoice.disputeStatus === outcome) return { outcome: "duplicate", patch: {} };
    const patch: Partial<Invoice> = { disputeStatus: outcome, disputeResolvedAt: ev.occurredAt };
    // If we never saw dispute.created, still record the disputed amount now.
    if (invoice.amountDisputedCents === 0 && ev.amountDisputedCents) patch.amountDisputedCents = ev.amountDisputedCents;
    return { outcome: "applied", patch };
  }

  return { outcome: "unmapped", patch: {} };
}

/** Capture charge/payment_intent refs (only fill what's missing). */
function captureRefs(invoice: Invoice, ev: InvoiceEvent): Partial<Invoice> {
  const patch: Partial<Invoice> = {};
  if (ev.chargeId && !invoice.chargeId) patch.chargeId = ev.chargeId;
  if (ev.paymentIntentId && !invoice.paymentIntentId) patch.paymentIntentId = ev.paymentIntentId;
  return patch;
}

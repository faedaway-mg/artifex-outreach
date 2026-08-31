// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation by replay. The durable payment_events receipts are the source of
// truth for what the provider told us; the invoice's state is a PROJECTION of them.
//
// Replaying all recorded events for an invoice, in occurredAt order, through the
// idempotent reducer converges to the correct state regardless of delivery order,
// duplicates, or an event that arrived before the invoice existed. This is what we
// run after issuing (to absorb early events) and what a manual/scheduled
// reconciliation calls. An event is marked processed only after its effect commits.
// ─────────────────────────────────────────────────────────────────────────────
import type { Invoice, PaymentEvent } from "../types";
import { getInvoice, updateInvoice, paymentEventsForProviderInvoice, updatePaymentEvent } from "../repo";
import { applyInvoiceEvent, type InvoiceEvent } from "./invoice-events";
import { nowIso } from "../store";

function toInvoiceEvent(pe: PaymentEvent): InvoiceEvent {
  const obj = ((pe.payload as any)?.data?.object ?? {}) as {
    amount_refunded?: number; amount?: number; status?: string; charge?: string; payment_intent?: string;
  };
  return {
    type: pe.eventType,
    occurredAt: pe.occurredAt,
    amountRefundedCents: typeof obj.amount_refunded === "number" ? obj.amount_refunded : undefined,
    amountDisputedCents: typeof obj.amount === "number" && pe.eventType.startsWith("charge.dispute") ? obj.amount : undefined,
    disputeStatus: pe.eventType.startsWith("charge.dispute") ? obj.status : undefined,
    chargeId: obj.charge ? String(obj.charge) : undefined,
    paymentIntentId: obj.payment_intent ? String(obj.payment_intent) : undefined,
  };
}

export interface ReconcileResult {
  invoice: Invoice;
  applied: number;
  finalState: Invoice["state"];
}

/**
 * Replay every recorded event for this invoice's provider id, in order, folding the
 * reducer from the invoice's current state. Persists the net change once and marks
 * each event processed (linking it to the invoice).
 */
export async function reconcileInvoiceFromEvents(invoiceId: string): Promise<ReconcileResult | null> {
  const invoice = await getInvoice(invoiceId);
  if (!invoice || !invoice.providerInvoiceId) return null;

  // Gather receipts across ALL of this invoice's refs: the invoice id (invoice.*
  // events) plus the charge/PI ids (dispute/refund events key off those, not the
  // invoice id). Dedupe by receipt id, sort by occurredAt.
  const refs = [invoice.providerInvoiceId, invoice.chargeId, invoice.paymentIntentId].filter(Boolean) as string[];
  const collected = (await Promise.all(refs.map((r) => paymentEventsForProviderInvoice(r)))).flat();
  const byId = new Map(collected.map((e) => [e.id, e]));
  const events = [...byId.values()].sort((a, b) => +new Date(a.occurredAt) - +new Date(b.occurredAt));

  let current: Invoice = { ...invoice };
  const netPatch: Partial<Invoice> = {};
  let applied = 0;
  for (const pe of events) {
    const { outcome, patch } = applyInvoiceEvent(current, toInvoiceEvent(pe));
    if (outcome === "applied") {
      Object.assign(netPatch, patch);
      current = { ...current, ...patch };
      applied += 1;
    }
    // Mark the event processed + linked, whatever the outcome (it has been accounted for).
    if (!pe.processedAt || pe.invoiceId !== invoice.id) {
      await updatePaymentEvent(pe.id, { processedAt: pe.processedAt ?? nowIso(), invoiceId: invoice.id, outcome });
    }
  }
  if (applied > 0) await updateInvoice(invoice.id, netPatch);
  return { invoice: { ...current }, applied, finalState: current.state };
}

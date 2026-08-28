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
  const obj = ((pe.payload as any)?.data?.object ?? {}) as { amount_refunded?: number; status?: string };
  return {
    type: pe.eventType,
    occurredAt: pe.occurredAt,
    amountRefundedCents: typeof obj.amount_refunded === "number" ? obj.amount_refunded : undefined,
    disputeStatus: obj.status,
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

  const events = (await paymentEventsForProviderInvoice(invoice.providerInvoiceId)).sort(
    (a, b) => +new Date(a.occurredAt) - +new Date(b.occurredAt),
  );

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

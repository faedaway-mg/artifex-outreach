// ─────────────────────────────────────────────────────────────────────────────
// Stripe invoice webhook — verified, idempotent, account-isolated.
//
// Extends the existing deposit webhook protections to invoice.* / charge.* events:
//  • HMAC signature verified (reuses verifyStripeSignature), fail-closed in prod;
//  • the target invoice must belong to the issuer/account this endpoint serves
//    (test-mode events can't mutate another entity's live records);
//  • duplicate/out-of-order deliveries deduped via the shared event log;
//  • state applied by the pure reducer (money-state not forward-only).
// A browser redirect is never trusted — only signed events reach here.
// ─────────────────────────────────────────────────────────────────────────────
import { verifyStripeSignature } from "./stripe-webhook";
import { applyInvoiceEvent, type InvoiceEvent } from "./invoice-events";
import { getInvoiceByProviderId, getInvoiceByChargeId, getInvoiceByPaymentIntentId, updateInvoice, recordPaymentEventIfAbsent, updatePaymentEvent } from "../repo";
import type { Invoice } from "../types";
import { nowIso } from "../store";

export type InvoiceWebhookResult = { ok: boolean; status: number; kind: string; result?: string };

interface EventObject {
  id?: string;
  invoice?: string; // sometimes present on charge (version-dependent); never on disputes
  amount_refunded?: number;
  amount?: number; // dispute amount
  status?: string; // dispute status
  charge?: string; // dispute.charge
  payment_intent?: string; // dispute/charge/PI link — the PREFERRED resolver
}
interface EventShape {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: EventObject };
}

// Resolve the event to a local invoice using the best available link for its family:
// invoice.* → invoice id; charge/dispute/PI → payment_intent, then charge, then any
// inline invoice id. Disputes carry NO invoice field, so PI/charge is required.
async function resolveInvoice(type: string, obj: EventObject): Promise<Invoice | undefined> {
  if (type.startsWith("invoice.")) {
    const id = obj.invoice ?? obj.id;
    return id ? getInvoiceByProviderId(String(id)) : undefined;
  }
  if (obj.payment_intent) {
    const byPi = await getInvoiceByPaymentIntentId(String(obj.payment_intent));
    if (byPi) return byPi;
  }
  // charge.* : obj.id is the charge id; dispute.* : obj.charge is the charge id.
  const chargeId = type.startsWith("charge.dispute") ? obj.charge : obj.id ?? obj.charge;
  if (chargeId) {
    const byCharge = await getInvoiceByChargeId(String(chargeId));
    if (byCharge) return byCharge;
  }
  if (obj.invoice) return getInvoiceByProviderId(String(obj.invoice));
  return undefined;
}

export async function handleStripeInvoiceWebhook(input: {
  rawBody: string;
  signature: string | null;
  secret: string | null;
  isProduction: boolean;
  /** The issuer whose account/endpoint this is. Enforces account isolation. */
  expectedIssuerId: string;
  nowSec?: number;
}): Promise<InvoiceWebhookResult> {
  // 1) Authenticate the delivery.
  if (input.secret) {
    if (!verifyStripeSignature(input.secret, input.rawBody, input.signature, { nowSec: input.nowSec })) {
      return { ok: false, status: 401, kind: "invalid_signature" };
    }
  } else if (input.isProduction) {
    return { ok: false, status: 401, kind: "no_secret" };
  }

  let event: EventShape;
  try {
    event = JSON.parse(input.rawBody) as EventShape;
  } catch {
    return { ok: false, status: 400, kind: "bad_json" };
  }
  const type = String(event.type ?? "");
  const eventId = String(event.id ?? "") || `${type}:${event.created ?? ""}`;
  const obj = event.data?.object ?? {};
  const occurredAt = event.created ? new Date(event.created * 1000).toISOString() : nowIso();

  // A durable-receipt reference for retention/replay. For invoice.* it's the invoice
  // id; otherwise the best money link (payment_intent, then charge). Disputes carry
  // no invoice id — hence PI/charge (see Stripe docs, verified 2026-08-27).
  const receiptRef = type.startsWith("invoice.")
    ? String(obj.invoice ?? obj.id ?? "")
    : String(obj.payment_intent ?? obj.charge ?? obj.id ?? obj.invoice ?? "");
  if (!receiptRef) return { ok: true, status: 200, kind: type || "unknown", result: "no_ref" };

  // 2) DURABLE RECEIPT FIRST — recorded (deduped by event id) BEFORE any effect, so
  // an event that arrives before its invoice, or whose apply fails, is never lost.
  const { inserted, row: receipt } = await recordPaymentEventIfAbsent({
    provider: "stripe",
    eventId,
    eventType: type,
    providerInvoiceId: receiptRef,
    invoiceId: null,
    issuerId: null,
    payload: event as unknown,
    occurredAt,
    receivedAt: nowIso(),
    processedAt: null,
    outcome: null,
  });
  // A duplicate delivery: the first receipt already governs; do not re-apply.
  if (!inserted) return { ok: true, status: 200, kind: type, result: "duplicate" };

  const invoice = await resolveInvoice(type, obj);
  if (!invoice) {
    // The invoice/mapping doesn't exist yet (event raced ahead, or PI/charge not yet
    // linked). Receipt retained UNPROCESSED, replayed by reconciliation. Nothing lost.
    await updatePaymentEvent(receipt.id, { outcome: "pending_unmatched" });
    return { ok: true, status: 200, kind: type, result: "pending_unmatched" };
  }

  // 3) Account/environment isolation: reject events for a different issuer's account.
  if (invoice.issuerId !== input.expectedIssuerId) {
    await updatePaymentEvent(receipt.id, { invoiceId: invoice.id, issuerId: invoice.issuerId, outcome: "issuer_mismatch" });
    return { ok: false, status: 409, kind: type, result: "issuer_mismatch" };
  }

  // 4) Apply via the pure reducer. Mark the receipt PROCESSED only after the effect
  // commits — a failed apply leaves processedAt null so reconciliation retries it.
  const ev: InvoiceEvent = {
    type,
    occurredAt,
    amountRefundedCents: typeof obj.amount_refunded === "number" ? obj.amount_refunded : undefined,
    amountDisputedCents: typeof obj.amount === "number" && type.startsWith("charge.dispute") ? obj.amount : undefined,
    disputeStatus: type.startsWith("charge.dispute") ? obj.status : undefined,
    chargeId: obj.charge ? String(obj.charge) : undefined,
    paymentIntentId: obj.payment_intent ? String(obj.payment_intent) : undefined,
  };
  const { outcome, patch } = applyInvoiceEvent(invoice, ev);
  if (outcome === "applied") await updateInvoice(invoice.id, patch);
  await updatePaymentEvent(receipt.id, { invoiceId: invoice.id, issuerId: invoice.issuerId, processedAt: nowIso(), outcome });
  return { ok: true, status: 200, kind: type, result: outcome };
}

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
import { getInvoiceByProviderId, updateInvoice, insertAgreementEventIfAbsent } from "../repo";

export type InvoiceWebhookResult = { ok: boolean; status: number; kind: string; result?: string };

interface EventShape {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: { id?: string; invoice?: string; amount_refunded?: number; status?: string; charge?: string } };
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
  const eventId = String(event.id ?? "");
  const obj = event.data?.object ?? {};
  // invoice.* events carry the invoice id as object.id; charge.* carry it as object.invoice.
  const providerInvoiceId = String(obj.invoice ?? obj.id ?? "");
  if (!providerInvoiceId) return { ok: true, status: 200, kind: type || "unknown", result: "no_invoice_ref" };

  const invoice = await getInvoiceByProviderId(providerInvoiceId);
  if (!invoice) return { ok: true, status: 200, kind: type, result: "unmatched" };

  // 2) Account/environment isolation: reject events for a different issuer's account.
  if (invoice.issuerId !== input.expectedIssuerId) {
    return { ok: false, status: 409, kind: type, result: "issuer_mismatch" };
  }

  // 3) Idempotency: dedupe by Stripe event id across deliveries.
  const dedupeKey = `stripe-invoice:${eventId || `${type}:${providerInvoiceId}:${event.created ?? ""}`}`;
  const { inserted } = await insertAgreementEventIfAbsent({
    agreementId: invoice.agreementId,
    provider: "stripe",
    eventType: type,
    dedupeKey,
    payload: event as unknown,
    occurredAt: event.created ? new Date(event.created * 1000).toISOString() : new Date().toISOString(),
  });
  if (!inserted) return { ok: true, status: 200, kind: type, result: "duplicate" };

  // 4) Apply via the pure reducer.
  const ev: InvoiceEvent = {
    type,
    occurredAt: event.created ? new Date(event.created * 1000).toISOString() : new Date().toISOString(),
    amountRefundedCents: typeof obj.amount_refunded === "number" ? obj.amount_refunded : undefined,
    disputeStatus: obj.status,
  };
  const { outcome, patch } = applyInvoiceEvent(invoice, ev);
  if (outcome === "applied") await updateInvoice(invoice.id, patch);
  return { ok: true, status: 200, kind: type, result: outcome };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook — verified deposit payment confirmation. On checkout.session
// .completed we mark the matching deposit paid and advance the lead to Deposit
// Paid. Verification uses Stripe's documented scheme: header "Stripe-Signature:
// t=<ts>,v1=<hmac>", signed payload = "<ts>.<rawBody>", HMAC-SHA256 hex against
// STRIPE_WEBHOOK_SECRET. Fail closed in production if no secret is set.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStripeSessionPayment, updatePayment, getPayment, updateLead, getAgreement } from "../repo";
import { nowIso } from "../store";

export function verifyStripeSignature(secret: string, rawBody: string, header: string | null, opts: { toleranceSec?: number; nowSec?: number } = {}): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=").map((x) => x.trim())));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const tolerance = opts.toleranceSec ?? 300;
  const ts = Number(t);
  if (!Number.isFinite(ts)) return false;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > tolerance) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type StripeWebhookResult = { ok: boolean; status: number; kind: string; result?: string };

export async function handleStripeWebhook(input: {
  rawBody: string;
  signature: string | null;
  secret?: string | null;
  isProduction?: boolean;
}): Promise<StripeWebhookResult> {
  const secret = input.secret ?? null;
  if (secret) {
    if (!verifyStripeSignature(secret, input.rawBody, input.signature)) return { ok: false, status: 401, kind: "invalid_signature" };
  } else if (input.isProduction) {
    return { ok: false, status: 401, kind: "no_secret" };
  }

  let event: any;
  try {
    event = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, status: 400, kind: "bad_json" };
  }

  const type = String(event.type ?? "");
  if (type !== "checkout.session.completed" && type !== "checkout.session.async_payment_succeeded") {
    return { ok: true, status: 200, kind: type || "unknown", result: "ignored" };
  }

  const session = event.data?.object ?? {};
  const sessionId = String(session.id ?? "");
  if (!sessionId) return { ok: true, status: 200, kind: type, result: "no-session" };

  const payment = await getStripeSessionPayment(sessionId);
  if (!payment) return { ok: true, status: 200, kind: type, result: "unmatched" };
  if (payment.status === "paid") return { ok: true, status: 200, kind: type, result: "duplicate" };

  await updatePayment(payment.id, { status: "paid", paidAt: nowIso() });
  // Advance the lead only if the deposit's agreement is signed (defense in depth).
  const fresh = await getPayment(payment.id);
  if (fresh) {
    const agreement = await getAgreement(fresh.agreementId);
    if (agreement && agreement.status === "signed") {
      await updateLead(fresh.leadId, { pipelineStage: "Deposit Paid" });
    }
  }
  return { ok: true, status: 200, kind: type, result: "applied" };
}

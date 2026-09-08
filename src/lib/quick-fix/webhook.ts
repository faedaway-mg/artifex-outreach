// ─────────────────────────────────────────────────────────────────────────────
// STRIPE WEBHOOK — the ONLY source of truth for "paid". A browser redirect never
// marks a job paid. Signature-verified, idempotent (by event id), replay-safe.
//
// Pure core: verifyStripeSignature + interpretEvent. The route wires persistence.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SubscriptionState } from "./types";

/** Constant-time verification of a Stripe-Signature header. */
export function verifyStripeSignature(args: {
  payload: string;
  header: string | null;
  secret: string;
  nowSec: number;
  toleranceSec?: number;
}): { ok: boolean; reason?: string } {
  const { payload, header, secret, nowSec } = args;
  const tolerance = args.toleranceSec ?? 300;
  if (!header) return { ok: false, reason: "missing signature header" };
  if (!secret) return { ok: false, reason: "missing webhook secret" };

  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return { ok: false, reason: "malformed signature header" };

  const ts = Number(parts.t);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSec - ts) > tolerance) return { ok: false, reason: "timestamp outside tolerance (replay)" };

  const expected = createHmac("sha256", secret).update(`${parts.t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

export type WebhookOutcome =
  | { kind: "payment_succeeded"; offerId: string; leadId: string; offerVersion: string; sessionId: string; subscriptionId: string | null }
  | { kind: "subscription_changed"; offerId: string; leadId: string; subscriptionId: string; state: SubscriptionState }
  | { kind: "ignored"; reason: string };

interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: any };
}

function metaOf(obj: any): Record<string, string> {
  return (obj?.metadata ?? {}) as Record<string, string>;
}

const SUB_STATE: Record<string, SubscriptionState> = {
  active: "ACTIVE",
  trialing: "ACTIVE",
  past_due: "PAST_DUE",
  unpaid: "PAST_DUE",
  canceled: "CANCELED",
  incomplete: "INCOMPLETE",
  incomplete_expired: "CANCELED",
};

/** Pure mapping of a Stripe event → a normalized outcome. No side effects. */
export function interpretEvent(event: StripeEvent): WebhookOutcome {
  const obj = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed": {
      // Only a paid session counts.
      if (obj.payment_status && obj.payment_status !== "paid" && obj.payment_status !== "no_payment_required") {
        return { kind: "ignored", reason: `session not paid (${obj.payment_status})` };
      }
      const m = metaOf(obj);
      if (!m.offerId) return { kind: "ignored", reason: "no offerId in session metadata" };
      return {
        kind: "payment_succeeded",
        offerId: m.offerId,
        leadId: m.leadId ?? "",
        offerVersion: m.offerVersion ?? "",
        sessionId: String(obj.id ?? ""),
        subscriptionId: obj.subscription ? String(obj.subscription) : null,
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const m = metaOf(obj);
      if (!m.offerId) return { kind: "ignored", reason: "no offerId in subscription metadata" };
      const state = SUB_STATE[String(obj.status)] ?? "INCOMPLETE";
      return { kind: "subscription_changed", offerId: m.offerId, leadId: m.leadId ?? "", subscriptionId: String(obj.id ?? ""), state };
    }
    case "invoice.payment_failed": {
      const m = metaOf(obj);
      const subId = obj.subscription ? String(obj.subscription) : "";
      if (!m.offerId || !subId) return { kind: "ignored", reason: "no offer/subscription on failed invoice" };
      return { kind: "subscription_changed", offerId: m.offerId, leadId: m.leadId ?? "", subscriptionId: subId, state: "PAST_DUE" };
    }
    default:
      return { kind: "ignored", reason: `unhandled event type ${event.type}` };
  }
}

export interface WebhookDeps {
  alreadyProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string, outcome: WebhookOutcome): Promise<void>;
  applyPaid(o: Extract<WebhookOutcome, { kind: "payment_succeeded" }>): Promise<void>;
  applySubscription(o: Extract<WebhookOutcome, { kind: "subscription_changed" }>): Promise<void>;
}

export interface WebhookHandleResult {
  ok: boolean;
  duplicate: boolean;
  outcome: WebhookOutcome;
}

/** Idempotent, replay-safe application of a verified event. */
export async function handleVerifiedEvent(event: StripeEvent, deps: WebhookDeps): Promise<WebhookHandleResult> {
  if (await deps.alreadyProcessed(event.id)) {
    return { ok: true, duplicate: true, outcome: { kind: "ignored", reason: "duplicate event (already processed)" } };
  }
  const outcome = interpretEvent(event);
  if (outcome.kind === "payment_succeeded") await deps.applyPaid(outcome);
  else if (outcome.kind === "subscription_changed") await deps.applySubscription(outcome);
  // Mark processed AFTER applying so a crash mid-apply safely retries.
  await deps.markProcessed(event.id, outcome);
  return { ok: true, duplicate: false, outcome };
}

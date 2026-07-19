// ─────────────────────────────────────────────────────────────────────────────
// Minimal Stripe deposit link — NOT invoicing/accounting (both out of scope).
//
// Creates a Stripe Checkout Session (mode=payment) with inline price_data and
// returns its shareable URL — one API call, no pre-created Product/Price needed.
// Over `fetch`, no SDK. Disabled by default: if STRIPE_SECRET_KEY is unset the
// caller falls back to an operator-pasted payment link. Never logs the key.
// ─────────────────────────────────────────────────────────────────────────────

import { ARTIFEX_IDENTITY } from "../identity";

const API_BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
const TIMEOUT_MS = Number(process.env.STRIPE_TIMEOUT_MS ?? 15_000);

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export interface DepositLinkInput {
  amountCents: number;
  currency: string;
  productName: string;
  metadata?: Record<string, string>;
}

export interface DepositLinkResult {
  ok: boolean;
  url: string | null;
  sessionId: string | null;
  error?: string;
}

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export async function createDepositCheckoutSession(input: DepositLinkInput): Promise<DepositLinkResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, url: null, sessionId: null, error: "STRIPE_SECRET_KEY not set." };

  // Client-facing redirect targets. Default to the public marketing site (which
  // exists) rather than an app route the client can't reach — overridable via env.
  const site = ARTIFEX_IDENTITY.publicWebsite.replace(/\/$/, "");
  const successUrl = process.env.STRIPE_DEPOSIT_SUCCESS_URL ?? site;
  const cancelUrl = process.env.STRIPE_DEPOSIT_CANCEL_URL ?? site;
  const params: Record<string, string> = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][price_data][product_data][name]": input.productName,
    success_url: successUrl,
    cancel_url: cancelUrl,
  };
  for (const [k, v] of Object.entries(input.metadata ?? {})) params[`metadata[${k}]`] = v;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/v1/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form(params),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      console.error(`[stripe] checkout session failed status=${res.status}`);
      return { ok: false, url: null, sessionId: null, error: `Stripe HTTP ${res.status}: ${text}` };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
    return { ok: true, url: json.url ?? null, sessionId: json.id ?? null };
  } catch (e) {
    return { ok: false, url: null, sessionId: null, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE COMMERCE — map an approved offer to a Stripe Checkout Session, with full
// traceability metadata and IDEMPOTENT reconciliation (no catalog explosion).
//
// We use inline price_data on Checkout Sessions (no pre-created Product/Price per
// variation). Path A = one-time fix (mode=payment). Path B = fix + recurring care
// (mode=subscription: the fix rides the first invoice, the plan recurs). Every
// object carries leadId / offerId / offerVersion / pricingBand so any purchase is
// traceable back to the exact evidence-backed offer.
//
// The network client is injected — tests and dry-runs pass a fake and NEVER touch
// Stripe. The live client only exists here and is only used when explicitly wired.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { maintenancePlanByKey } from "./maintenance";
import { ARTIFEX_IDENTITY } from "../identity";

export interface CheckoutLineItem {
  currency: string;
  unitAmountCents: number;
  name: string;
  /** Present → recurring; absent → one-time (rides first invoice in sub mode). */
  recurringInterval?: "month";
}

export interface CheckoutParams {
  mode: "payment" | "subscription";
  lineItems: CheckoutLineItem[];
  metadata: Record<string, string>;
  /** Metadata copied onto the Subscription (sub mode) for lifecycle traceability. */
  subscriptionMetadata?: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  customerEmail?: string;
  /** Stripe idempotency key — safe retries never double-create. */
  idempotencyKey: string;
}

export interface CheckoutResult {
  ok: boolean;
  id: string | null;
  url: string | null;
  error?: string;
}

export interface StripeCheckoutClient {
  create(params: CheckoutParams): Promise<CheckoutResult>;
}

/** Persisted mapping so we never recreate commerce objects for the same offer. */
export interface CommerceRecord {
  key: string; // `${offerId}:${offerVersion}:${kind}`
  offerId: string;
  leadId: string;
  offerVersion: string;
  kind: CheckoutKind;
  priceCents: number;
  sessionId: string | null;
  url: string | null;
  superseded: boolean;
  createdAt: string;
}

export interface CommerceStore {
  get(key: string): Promise<CommerceRecord | null>;
  /** All records for an offer (to supersede old versions). */
  listForOffer(offerId: string): Promise<CommerceRecord[]>;
  put(rec: CommerceRecord): Promise<void>;
}

export type CheckoutKind = "one_time" | "with_maintenance";

export function commerceKey(offerId: string, offerVersion: string, kind: CheckoutKind): string {
  return `${offerId}:${offerVersion}:${kind}`;
}

export function offerMetadata(offer: QuickFixOffer, kind: CheckoutKind): Record<string, string> {
  return {
    leadId: offer.leadId,
    companyName: offer.companyName.slice(0, 200),
    offerId: offer.offerId,
    offerVersion: offer.offerVersion,
    pricingBand: offer.band,
    priceCents: String(offer.priceCents),
    // Full traceability (mandate: leadId/offerId/offerVersion/SKU/price version/purchase type).
    sku: offer.capabilityKeys[0] ?? "",
    priceVersion: `pv-${offer.band.toLowerCase()}-baseline`,
    purchaseType: "REPAIR",
    kind,
    source: "acquisition-os-quick-fix",
  };
}

export interface BuildParamsOpts {
  withMaintenance: boolean;
  baseUrl: string;
  customerEmail?: string;
  successUrl?: string;
  cancelUrl?: string;
}

/** Pure: build the exact Checkout params for an offer. No side effects. */
export function buildCheckoutParams(offer: QuickFixOffer, opts: BuildParamsOpts): CheckoutParams {
  const kind: CheckoutKind = opts.withMaintenance ? "with_maintenance" : "one_time";
  const site = ARTIFEX_IDENTITY.publicWebsite.replace(/\/$/, "");
  const successUrl = opts.successUrl ?? `${opts.baseUrl.replace(/\/$/, "")}/offer/${offer.offerId}/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = opts.cancelUrl ?? `${opts.baseUrl.replace(/\/$/, "")}/offer/${offer.offerId}`;

  const lineItems: CheckoutLineItem[] = [
    { currency: offer.currency, unitAmountCents: offer.priceCents, name: offer.scope.offerName },
  ];
  let subscriptionMetadata: Record<string, string> | undefined;

  if (opts.withMaintenance && offer.maintenance) {
    const plan = maintenancePlanByKey(offer.maintenance.planKey);
    if (plan) {
      lineItems.push({ currency: offer.currency, unitAmountCents: plan.monthlyCents, name: plan.name, recurringInterval: "month" });
      subscriptionMetadata = { ...offerMetadata(offer, kind), planKey: plan.key };
    }
  }

  const mode: CheckoutParams["mode"] = lineItems.some((l) => l.recurringInterval) ? "subscription" : "payment";

  return {
    mode,
    lineItems,
    metadata: offerMetadata(offer, kind),
    subscriptionMetadata,
    successUrl: successUrl || site,
    cancelUrl: cancelUrl || site,
    clientReferenceId: offer.offerId,
    customerEmail: opts.customerEmail,
    idempotencyKey: commerceKey(offer.offerId, offer.offerVersion, kind),
  };
}

export interface ReconcileResult {
  ok: boolean;
  reused: boolean;
  record: CommerceRecord | null;
  error?: string;
}

/**
 * Idempotently ensure a checkout exists for (offer, kind). Reuses the stored
 * session for the same offerVersion; supersedes records for older versions.
 * Assumes the caller already passed validateOfferForPurchase().
 */
export async function reconcileOfferCheckout(args: {
  offer: QuickFixOffer;
  kind: CheckoutKind;
  client: StripeCheckoutClient;
  store: CommerceStore;
  baseUrl: string;
  customerEmail?: string;
  now: string;
}): Promise<ReconcileResult> {
  const { offer, kind, client, store } = args;
  const key = commerceKey(offer.offerId, offer.offerVersion, kind);

  const existing = await store.get(key);
  if (existing && existing.url && !existing.superseded) {
    return { ok: true, reused: true, record: existing };
  }

  // Supersede any records for prior versions of this offer (price/scope changed).
  for (const rec of await store.listForOffer(offer.offerId)) {
    if (rec.offerVersion !== offer.offerVersion && !rec.superseded) {
      await store.put({ ...rec, superseded: true });
    }
  }

  const params = buildCheckoutParams(offer, { withMaintenance: kind === "with_maintenance", baseUrl: args.baseUrl, customerEmail: args.customerEmail });
  const res = await client.create(params);
  if (!res.ok) return { ok: false, reused: false, record: null, error: res.error };

  const record: CommerceRecord = {
    key,
    offerId: offer.offerId,
    leadId: offer.leadId,
    offerVersion: offer.offerVersion,
    kind,
    priceCents: offer.priceCents,
    sessionId: res.id,
    url: res.url,
    superseded: false,
    createdAt: args.now,
  };
  await store.put(record);
  return { ok: true, reused: false, record };
}

// ── Live client (only used when explicitly wired; never in tests/dry-run) ──────
const API_BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
const TIMEOUT_MS = Number(process.env.STRIPE_TIMEOUT_MS ?? 15_000);

function encodeForm(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Build the flat form body Stripe expects for a Checkout Session. Pure + testable. */
export function toStripeForm(params: CheckoutParams): Record<string, string> {
  const out: Record<string, string> = {
    mode: params.mode,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.clientReferenceId,
  };
  if (params.customerEmail) out.customer_email = params.customerEmail;
  params.lineItems.forEach((li, i) => {
    out[`line_items[${i}][quantity]`] = "1";
    out[`line_items[${i}][price_data][currency]`] = li.currency.toLowerCase();
    out[`line_items[${i}][price_data][unit_amount]`] = String(li.unitAmountCents);
    out[`line_items[${i}][price_data][product_data][name]`] = li.name;
    if (li.recurringInterval) out[`line_items[${i}][price_data][recurring][interval]`] = li.recurringInterval;
  });
  for (const [k, v] of Object.entries(params.metadata)) out[`metadata[${k}]`] = v;
  if (params.subscriptionMetadata) {
    for (const [k, v] of Object.entries(params.subscriptionMetadata)) out[`subscription_data[metadata][${k}]`] = v;
  }
  return out;
}

/** The live checkout client. Pass the mode-resolved Quick-Fix key (test or live);
 *  defaults to STRIPE_SECRET_KEY for back-compat. The key is used only for the
 *  Authorization header and is never logged. */
export function liveStripeCheckoutClient(secretKey?: string): StripeCheckoutClient {
  return {
    async create(params: CheckoutParams): Promise<CheckoutResult> {
      const keyEnv = secretKey ?? process.env.STRIPE_SECRET_KEY;
      if (!keyEnv) return { ok: false, id: null, url: null, error: "Stripe key not set" };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}/v1/checkout/sessions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${keyEnv}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": params.idempotencyKey,
          },
          body: encodeForm(toStripeForm(params)),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = (await res.text().catch(() => "")).slice(0, 200);
          return { ok: false, id: null, url: null, error: `Stripe HTTP ${res.status}: ${text}` };
        }
        const json = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
        return { ok: true, id: json.id ?? null, url: json.url ?? null };
      } catch (e) {
        return { ok: false, id: null, url: null, error: (e as Error).message };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

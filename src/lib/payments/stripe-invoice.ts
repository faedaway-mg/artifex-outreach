// ─────────────────────────────────────────────────────────────────────────────
// Stripe Invoices adapter (M2) — client-specific hosted invoices bound to an
// agreement version + milestone. Separate from the legacy Checkout deposit link.
//
// Provider account MATCHES THE ISSUER: the secret key is read from the issuer's
// configured env-var NAME (never a literal). A record whose issuer has no
// configured key is REFUSED — it never falls through to another entity's account.
//
// "Prepare" (create a draft invoice) is distinct from "issue" (finalize/send).
// A live issue is gated by the caller; this adapter additionally refuses to touch
// a LIVE key when the caller requires test mode, so a rehearsal cannot charge.
//
// fetchImpl is injectable so the sequence is unit-testable without a network.
// ─────────────────────────────────────────────────────────────────────────────
import { getIssuer } from "../billing/issuer";

const API_BASE = process.env.STRIPE_API_BASE ?? "https://api.stripe.com";
const TIMEOUT_MS = Number(process.env.STRIPE_TIMEOUT_MS ?? 15_000);

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export function isTestKey(key: string): boolean {
  return /^(sk|rk)_test_/.test(key);
}
export function isLiveKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key);
}

export interface KeyResolution {
  ok: boolean;
  key?: string;
  envVar: string;
  error?: string;
}

/**
 * Resolve the Stripe secret key for an issuer by env-var NAME. Returns the missing
 * var name (not a value) when unset. Never returns another issuer's key.
 */
export function resolveStripeKeyForIssuer(issuerId: string): KeyResolution {
  const issuer = getIssuer(issuerId);
  if (!issuer) return { ok: false, envVar: "(unknown issuer)", error: `Unknown issuer '${issuerId}'.` };
  const envVar = issuer.stripeSecretEnvVar;
  const key = process.env[envVar];
  if (!key) return { ok: false, envVar, error: `Missing Stripe credential: set ${envVar} for issuer '${issuerId}'.` };
  return { ok: true, key, envVar };
}

export interface InvoiceOpContext {
  issuerId: string;
  /** When true, refuse to proceed against a live key (rehearsal safety). */
  requireTestMode: boolean;
  fetchImpl?: FetchImpl;
}

export interface AdapterResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  /** True when blocked by config/mode rather than a provider error. */
  blocked?: boolean;
}

function form(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Shared guard: resolve key for issuer and enforce the requested mode. */
function guardKey(ctx: InvoiceOpContext): KeyResolution & { blocked?: boolean } {
  const res = resolveStripeKeyForIssuer(ctx.issuerId);
  if (!res.ok) return { ...res, blocked: true };
  if (ctx.requireTestMode && !isTestKey(res.key!)) {
    return { ok: false, envVar: res.envVar, error: `${res.envVar} is not a test key; refusing in test-mode rehearsal.`, blocked: true };
  }
  return res;
}

async function call<T>(ctx: InvoiceOpContext, path: string, params: Record<string, string>): Promise<AdapterResult<T>> {
  const g = guardKey(ctx);
  if (!g.ok) return { ok: false, error: g.error, blocked: g.blocked };
  const doFetch = ctx.fetchImpl ?? (globalThis.fetch as FetchImpl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${g.key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form(params),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, error: `Stripe HTTP ${res.status}: ${text}` };
    }
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export interface PrepareInvoiceInput extends InvoiceOpContext {
  customerEmail: string;
  customerName: string;
  amountCents: number;
  currency: string;
  description: string;
  metadata: Record<string, string>;
}

export interface PreparedInvoice {
  customerId: string;
  invoiceId: string;
}

/**
 * PREPARE: create customer → DRAFT invoice → attach the line item TO THAT INVOICE.
 * Does NOT finalize or send (auto_advance=false). The item is created with an explicit
 * `invoice` id rather than as a pending customer item, because current Stripe API
 * versions default `pending_invoice_items_behavior` to "exclude" — a pending item
 * would otherwise NOT be pulled in, finalizing a $0 invoice. (Caught by the Gate-3
 * client-facing walkthrough.)
 */
export async function prepareInvoice(input: PrepareInvoiceInput): Promise<AdapterResult<PreparedInvoice>> {
  const cust = await call<{ id?: string }>(input, "/v1/customers", {
    email: input.customerEmail,
    name: input.customerName,
  });
  if (!cust.ok || !cust.data?.id) return { ok: false, error: cust.error ?? "customer create failed", blocked: cust.blocked };
  const customerId = cust.data.id;

  const invParams: Record<string, string> = {
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: "14",
    auto_advance: "false",
  };
  for (const [k, v] of Object.entries(input.metadata)) invParams[`metadata[${k}]`] = v;
  const inv = await call<{ id?: string }>(input, "/v1/invoices", invParams);
  if (!inv.ok || !inv.data?.id) return { ok: false, error: inv.error ?? "invoice create failed", blocked: inv.blocked };
  const invoiceId = inv.data.id;

  const item = await call<{ id?: string }>(input, "/v1/invoiceitems", {
    customer: customerId,
    invoice: invoiceId, // attach explicitly to THIS invoice
    amount: String(input.amountCents),
    currency: input.currency.toLowerCase(),
    description: input.description,
  });
  if (!item.ok) return { ok: false, error: item.error, blocked: item.blocked };

  return { ok: true, data: { customerId, invoiceId } };
}

export interface IssuedInvoice {
  invoiceId: string;
  hostedInvoiceUrl: string | null;
  status: string | null;
}

/** ISSUE: finalize a draft invoice → returns the hosted invoice URL. */
export async function finalizeInvoice(ctx: InvoiceOpContext, invoiceId: string): Promise<AdapterResult<IssuedInvoice>> {
  const r = await call<{ id?: string; hosted_invoice_url?: string; status?: string }>(
    ctx,
    `/v1/invoices/${encodeURIComponent(invoiceId)}/finalize`,
    {},
  );
  if (!r.ok) return { ok: false, error: r.error, blocked: r.blocked };
  return {
    ok: true,
    data: { invoiceId, hostedInvoiceUrl: r.data?.hosted_invoice_url ?? null, status: r.data?.status ?? null },
  };
}

/** VOID: cancel an issued invoice (no obligation). */
export async function voidInvoice(ctx: InvoiceOpContext, invoiceId: string): Promise<AdapterResult<{ status: string | null }>> {
  const r = await call<{ status?: string }>(ctx, `/v1/invoices/${encodeURIComponent(invoiceId)}/void`, {});
  if (!r.ok) return { ok: false, error: r.error, blocked: r.blocked };
  return { ok: true, data: { status: r.data?.status ?? null } };
}

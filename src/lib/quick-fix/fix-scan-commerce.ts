// ─────────────────────────────────────────────────────────────────────────────
// FIX SCAN COMMERCE — Stripe checkout for the standalone $99 Fix Scan SKU, and the
// repair-after-scan checkout that applies the single-use $99 credit.
//
// The credit is wired as a CONTROLLED CHECKOUT DISCOUNT: the server resolves the
// final amount (repair price − credit) and charges exactly that inline amount. No
// pre-created Stripe Coupon/Promotion is required, so activating it needs NO
// account-side action. Single-use is enforced at the webhook (verified payment),
// never by the browser. Every object carries full traceability metadata.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import type { CheckoutParams } from "./stripe-commerce";
import { offerMetadata, productTaxCode } from "./stripe-commerce";
import { fixScanCheckoutDescription, repairCheckoutDescription } from "./stripe-copy";
import { FIX_SCAN_SKU, applyCredit, type CreditRecord, type CreditApplication } from "./fix-scan";

/** Deterministic id for a lead's Fix Scan purchase (one active scan per lead). */
export function fixScanOfferId(leadId: string): string {
  return `qfs_${leadId}`;
}

export interface FixScanCheckoutOpts {
  leadId: string;
  companyName: string;
  baseUrl: string;
  customerEmail?: string;
}

/** Build the $99 Fix Scan Checkout params. Fixed price, never LLM-set. */
export function buildFixScanCheckoutParams(opts: FixScanCheckoutOpts): CheckoutParams {
  const base = opts.baseUrl.replace(/\/$/, "");
  const id = fixScanOfferId(opts.leadId);
  const desc = fixScanCheckoutDescription(opts.companyName); // "Artifex Fix Scan — Website Diagnostic — <company>"
  return {
    mode: "payment",
    lineItems: [{ currency: "usd", unitAmountCents: FIX_SCAN_SKU.priceCents, name: FIX_SCAN_SKU.name, description: desc, taxCode: productTaxCode() }],
    metadata: {
      leadId: opts.leadId,
      companyName: opts.companyName.slice(0, 200),
      offerId: id,
      offerVersion: FIX_SCAN_SKU.version,
      sku: FIX_SCAN_SKU.key,
      serviceName: "Website Diagnostic",
      priceCents: String(FIX_SCAN_SKU.priceCents),
      purchaseType: "FIX_SCAN",
      kind: "one_time",
      source: "acquisition-os-fix-scan",
    },
    successUrl: `${base}/offer/${id}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/offer/${id}`,
    clientReferenceId: id,
    customerEmail: opts.customerEmail,
    paymentIntentDescription: desc,
    idempotencyKey: `${id}:fixscan:one_time`,
  };
}

export interface RepairAfterScanResult {
  params: CheckoutParams;
  application: CreditApplication;
  finalPriceCents: number;
}

/**
 * Build the repair Checkout with an eligible Fix Scan credit applied as a
 * controlled inline discount. If the credit does not apply (missing/used/expired/
 * over cap), the customer is charged the full repair price and creditApplied = 0.
 * The credit is only CONSUMED at the verified webhook (single-use, fail-closed).
 */
export function buildRepairAfterScanCheckout(args: {
  offer: QuickFixOffer;
  credit: CreditRecord | null;
  scanOfferId: string | null;
  baseUrl: string;
  customerEmail?: string;
  nowMs: number;
}): RepairAfterScanResult {
  const { offer } = args;
  const application = applyCredit(args.credit, offer.priceCents, offer.offerId, args.nowMs);
  const finalPriceCents = application.finalPriceCents;
  const base = args.baseUrl.replace(/\/$/, "");
  const name = application.applies ? `${offer.scope.offerName} (Fix Scan credit applied)` : offer.scope.offerName;
  const desc = application.applies ? `${repairCheckoutDescription(offer)} (Fix Scan credit applied)` : repairCheckoutDescription(offer);

  const metadata: Record<string, string> = {
    ...offerMetadata(offer, "one_time"),
    creditAppliedCents: String(application.creditAppliedCents),
  };
  if (application.applies && args.scanOfferId) metadata.scanOfferId = args.scanOfferId;

  const params: CheckoutParams = {
    mode: "payment",
    lineItems: [{ currency: offer.currency, unitAmountCents: finalPriceCents, name, description: desc, taxCode: productTaxCode() }],
    metadata,
    successUrl: `${base}/offer/${offer.offerId}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/offer/${offer.offerId}`,
    clientReferenceId: offer.offerId,
    customerEmail: args.customerEmail,
    paymentIntentDescription: desc,
    // Include the credit in the key so a credited retry never reuses an uncredited session.
    idempotencyKey: `${offer.offerId}:${offer.offerVersion}:one_time:credit_${application.creditAppliedCents}`,
  };
  return { params, application, finalPriceCents };
}

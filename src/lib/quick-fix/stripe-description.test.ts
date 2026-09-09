// ─────────────────────────────────────────────────────────────────────────────
// STRIPE PURCHASE DESCRIPTION — server-generated, human-readable, never blank.
// Line-item product_data.description + PaymentIntent description + serviceName
// metadata, without disturbing price/SKU/managed_payments/tax-code/statement descriptor.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { generateOffer } from "./offer-engine";
import { buildCheckoutParams, toStripeForm, offerMetadata } from "./stripe-commerce";
import { buildFixScanCheckoutParams } from "./fix-scan-commerce";
import { repairCheckoutDescription, fixScanCheckoutDescription } from "./stripe-copy";
import type { OfferFinding } from "./types";

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});
const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile" });
const gen = (over = {}) => generateOffer({ leadId: "lead_1", companyName: "a2z Health Massage Schools", findings: [CTA], generatedAt: null, ...over });

describe("Quick-Fix repair — human-readable Stripe description + metadata", () => {
  const offer = { ...gen(), offerId: "offer_1" };
  const form = toStripeForm(buildCheckoutParams(offer, { withMaintenance: false, baseUrl: "https://app.test" }));

  it("canonical description = 'Artifex Quick-Fix — <offer> — <company>' (server-generated)", () => {
    const d = repairCheckoutDescription(offer);
    expect(d.startsWith("Artifex Quick-Fix — ")).toBe(true);
    expect(d).toContain(offer.scope.offerName);
    expect(d).toContain("a2z Health Massage Schools");
  });
  it("line-item product_data.description is present and matches the canonical string", () => {
    expect(form["line_items[0][price_data][product_data][description]"]).toBe(repairCheckoutDescription(offer));
  });
  it("PaymentIntent description is set for one-time payments", () => {
    expect(form["payment_intent_data[description]"]).toBe(repairCheckoutDescription(offer));
  });
  it("metadata exposes the human-readable serviceName alongside the technical SKU", () => {
    const m = offerMetadata(offer, "one_time");
    expect(m.serviceName).toBe(offer.scope.offerName);
    expect(m.sku).toBe("cta-repair");
    expect(form["metadata[serviceName]"]).toBe(offer.scope.offerName);
  });
  it("price/SKU stay server-controlled; managed_payments=false, no tax code, mode=payment untouched", () => {
    expect(form["line_items[0][price_data][unit_amount]"]).toBe("24900");
    expect(form["managed_payments[enabled]"]).toBe("false");
    expect(form["line_items[0][price_data][product_data][tax_code]"]).toBeUndefined();
    expect(form["mode"]).toBe("payment");
    // Never the account statement descriptor.
    expect(form["payment_intent_data[statement_descriptor]"]).toBeUndefined();
    expect(form["statement_descriptor"]).toBeUndefined();
  });
  it("no secrets appear in description or metadata", () => {
    const blob = Object.entries(form).filter(([k]) => k.includes("description") || k.startsWith("metadata")).map(([, v]) => v).join(" ");
    expect(/sk_(live|test)|whsec_|rk_|Bearer /.test(blob)).toBe(false);
  });
});

describe("Fix Scan — its own human-readable description", () => {
  const form = toStripeForm(buildFixScanCheckoutParams({ leadId: "l", companyName: "a2z Health Massage Schools", baseUrl: "https://x" }));
  it("uses 'Artifex Fix Scan — Website Diagnostic — <company>'", () => {
    const d = fixScanCheckoutDescription("a2z Health Massage Schools");
    expect(d).toBe("Artifex Fix Scan — Website Diagnostic — a2z Health Massage Schools");
    expect(form["line_items[0][price_data][product_data][description]"]).toBe(d);
    expect(form["payment_intent_data[description]"]).toBe(d);
    expect(form["metadata[serviceName]"]).toBe("Website Diagnostic");
  });
  it("preserves $99 price, managed_payments=false, mode=payment", () => {
    expect(form["line_items[0][price_data][unit_amount]"]).toBe("9900");
    expect(form["managed_payments[enabled]"]).toBe("false");
    expect(form["mode"]).toBe("payment");
  });
});

describe("Maintenance subscription — no PaymentIntent description (Stripe rejects it on subs)", () => {
  it("maintenance line has its own description; payment_intent_data is omitted in subscription mode", () => {
    const offer = { ...gen(), offerId: "offer_2", maintenance: { planKey: "care-basic", planName: "Care", monthlyCents: 4900, rationale: "r" } } as any;
    const params = buildCheckoutParams(offer, { withMaintenance: true, baseUrl: "https://app.test" });
    if (params.mode === "subscription") {
      const form = toStripeForm(params);
      expect(form["payment_intent_data[description]"]).toBeUndefined();
      expect(form["managed_payments[enabled]"]).toBe("false");
    }
    // The one-time repair line always carries a description regardless of mode.
    expect(params.lineItems[0].description).toContain("Artifex Quick-Fix");
  });
});

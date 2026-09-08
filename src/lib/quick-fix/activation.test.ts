// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATION GLUE TESTS — customer routes' service layer, checkout/credit wiring,
// webhook fulfillment (repair + Fix Scan + single-use credit), intake→ready, and
// the evergreen trust-asset ops. Runs against the in-memory store (no DB, no Stripe).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll } from "vitest";

import { generateOffer } from "./offer-engine";
import type { OfferFinding } from "./types";
import * as store from "./store";
import { buildPublicOfferView, paymentStatusView } from "./page-service";
import { buildFixScanCheckoutParams, buildRepairAfterScanCheckout, fixScanOfferId } from "./fix-scan-commerce";
import { createCredit, routeLead } from "./fix-scan";
import { interpretEvent, handleVerifiedEvent } from "./webhook";
import { validateOfferForPurchase, legalGateBlocked } from "./purchase-safety";
import { selectActiveEvergreen } from "./evergreen-asset";

beforeAll(() => { delete process.env.DATABASE_URL; }); // force the in-memory store

const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});
const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile" });
const gen = (over: Partial<Parameters<typeof generateOffer>[0]> = {}) =>
  generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings: [CTA], generatedAt: null, ...over });

describe("share-token access", () => {
  it("resolves by token and by offerId; revoke makes the token 404", async () => {
    const stored = await store.upsertOffer(gen(), { now: "t" });
    expect(stored.shareToken).toBeTruthy();
    expect(await store.getOfferByShareToken(stored.shareToken)).toMatchObject({ offerId: stored.offerId });
    expect(await store.resolveOffer(stored.offerId)).toMatchObject({ offerId: stored.offerId });
    await store.rotateShareToken(stored.offerId, { revoke: true, now: "t" });
    expect(await store.getOfferByShareToken(stored.shareToken)).toBeNull();
  });
});

describe("public offer view is customer-safe", () => {
  it("exposes no internal economics/rationale", async () => {
    const stored = await store.upsertOffer(gen({ leadId: "lead_safe" }), { now: "t" });
    await store.setApproval(stored.offerId, "approved", "op", "t");
    const v = await buildPublicOfferView(stored.offerId);
    expect(v?.model.priceLabel).toContain("$249");
    expect((v?.model as any).economics).toBeUndefined();
    // No internal economics leak into the customer view model.
    expect(JSON.stringify(v?.model)).not.toMatch(/effectiveHourly|grossContribution|clearsMarginGate|marginReasons|estimatedHours/);
  });
});

describe("server-side price resolution", () => {
  it("rejects a browser-tampered price but accepts the historical $250", () => {
    const o = gen();
    const bad = validateOfferForPurchase({ offer: { ...o, priceCents: 9999 }, approved: true, stripeConfigured: true, superseded: false, leadBlocked: false });
    expect(bad.reasons.some((r) => /not an approved version/.test(r))).toBe(true);
    const hist = validateOfferForPurchase({ offer: { ...o, priceCents: 25000 }, approved: true, stripeConfigured: true, superseded: false, leadBlocked: false });
    expect(hist.reasons.some((r) => /not an approved version/.test(r))).toBe(false);
  });
});

describe("production legal gate", () => {
  it("blocks live purchases in production until approved", () => {
    expect(legalGateBlocked({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toMatch(/legal review/i);
    expect(legalGateBlocked({ NODE_ENV: "production", QUICKFIX_LEGAL_APPROVED: "true" } as NodeJS.ProcessEnv)).toBeNull();
    expect(legalGateBlocked({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("Fix Scan checkout params", () => {
  it("is a fixed $99 with FIX_SCAN metadata", () => {
    const p = buildFixScanCheckoutParams({ leadId: "lead_1", companyName: "Acme", baseUrl: "https://x" });
    expect(p.lineItems[0].unitAmountCents).toBe(9900);
    expect(p.metadata.purchaseType).toBe("FIX_SCAN");
    expect(p.metadata.offerId).toBe(fixScanOfferId("lead_1"));
    expect(p.metadata.sku).toBe("artifex-fix-scan");
  });
});

describe("repair-after-scan credit (controlled discount, single-use)", () => {
  const o = { ...gen(), offerId: "qfo_test", priceCents: 24900 };
  const nowMs = new Date("2026-09-09T00:00:00Z").getTime();
  it("applies a valid credit as an inline discount", () => {
    const credit = createCredit("qfs_lead_1", "2026-09-08T00:00:00Z");
    const r = buildRepairAfterScanCheckout({ offer: o, credit, scanOfferId: "qfs_lead_1", baseUrl: "https://x", nowMs });
    expect(r.application.applies).toBe(true);
    expect(r.finalPriceCents).toBe(24900 - 9900);
    expect(r.params.lineItems[0].unitAmountCents).toBe(15000);
    expect(r.params.metadata.scanOfferId).toBe("qfs_lead_1");
    expect(Number(r.params.metadata.creditAppliedCents)).toBe(9900);
  });
  it("does not apply a used or expired credit (full price, no scan metadata)", () => {
    const used = { ...createCredit("qfs_lead_1", "2026-09-08T00:00:00Z"), used: true };
    const r1 = buildRepairAfterScanCheckout({ offer: o, credit: used, scanOfferId: "qfs_lead_1", baseUrl: "https://x", nowMs });
    expect(r1.application.applies).toBe(false);
    expect(r1.finalPriceCents).toBe(24900);
    expect(r1.params.metadata.scanOfferId).toBeUndefined();
    const expired = createCredit("qfs_lead_1", "2026-08-01T00:00:00Z");
    const r2 = buildRepairAfterScanCheckout({ offer: o, credit: expired, scanOfferId: "qfs_lead_1", baseUrl: "https://x", nowMs });
    expect(r2.application.applies).toBe(false);
  });
});

describe("webhook interpretation threads purchase type + credit", () => {
  it("maps FIX_SCAN and repair-with-credit metadata", () => {
    const scan = interpretEvent({ id: "e", type: "checkout.session.completed", data: { object: { id: "cs", payment_status: "paid", amount_total: 9900, metadata: { offerId: "qfs_lead_1", leadId: "lead_1", purchaseType: "FIX_SCAN", sku: "artifex-fix-scan" } } } });
    expect(scan).toMatchObject({ kind: "payment_succeeded", purchaseType: "FIX_SCAN", sku: "artifex-fix-scan", amountTotalCents: 9900 });
    const rep = interpretEvent({ id: "e2", type: "checkout.session.completed", data: { object: { id: "cs2", payment_status: "paid", metadata: { offerId: "qfo_x", purchaseType: "REPAIR", scanOfferId: "qfs_lead_1", creditAppliedCents: "9900" } } } });
    expect(rep).toMatchObject({ kind: "payment_succeeded", purchaseType: "REPAIR", creditScanOfferId: "qfs_lead_1", creditAppliedCents: 9900 });
  });
  it("a browser redirect / unpaid session never yields payment_succeeded", () => {
    const out = interpretEvent({ id: "e", type: "checkout.session.completed", data: { object: { id: "cs", payment_status: "unpaid", metadata: { offerId: "qfo_x" } } } });
    expect(out.kind).toBe("ignored");
  });
});

describe("verified webhook → job → intake → ready (single source of truth)", () => {
  it("creates a job, is idempotent, and intake starts the delivery clock", async () => {
    const stored = await store.upsertOffer(gen({ leadId: "lead_flow" }), { now: "t" });
    await store.setApproval(stored.offerId, "approved", "op", "t");
    const deps = await store.webhookDeps(store.fulfillmentHandlers("2026-09-08T00:00:00Z"));
    const evt = { id: "evt_flow", type: "checkout.session.completed", data: { object: { id: "cs", payment_status: "paid", metadata: { offerId: stored.offerId, leadId: "lead_flow", purchaseType: "REPAIR" } } } };
    const r = await handleVerifiedEvent(evt, deps);
    expect(r.outcome.kind).toBe("payment_succeeded");
    const job = await store.getJob(stored.offerId);
    expect(job?.state).toBe("WAITING_FOR_CUSTOMER_INPUT"); // cta-repair needs access → intake

    // Success page reads confirmed state — never decides payment itself.
    expect((await paymentStatusView(stored.offerId))?.status).toBe("INTAKE_REQUIRED");

    // Idempotent replay.
    expect((await handleVerifiedEvent(evt, deps)).duplicate).toBe(true);

    // Completing blocking intake advances to READY and starts the clock.
    const done = await store.completeIntake(stored.offerId, "2026-09-08T10:00:00Z");
    expect(done?.state).toBe("READY_FOR_FULFILLMENT");
    expect(done?.fulfillmentClockStartedAt).toBeTruthy();
    expect(done?.targetDeliveryAt).toBeTruthy();

    expect((await paymentStatusView("qfo_does_not_exist"))?.status).toBe("PAYMENT_NOT_CONFIRMED");
  });

  it("consumes a Fix Scan credit exactly once on a verified repair", async () => {
    await store.putCredit(createCredit("qfs_lead_credit", "2026-09-08T00:00:00Z"));
    const stored = await store.upsertOffer(gen({ leadId: "lead_credit" }), { now: "t" });
    await store.setApproval(stored.offerId, "approved", "op", "t");
    const deps = await store.webhookDeps(store.fulfillmentHandlers("2026-09-08T00:00:00Z"));
    const evt = { id: "evt_credit", type: "checkout.session.completed", data: { object: { id: "csc", payment_status: "paid", amount_total: stored.priceCents - 9900, metadata: { offerId: stored.offerId, leadId: "lead_credit", purchaseType: "REPAIR", scanOfferId: "qfs_lead_credit", creditAppliedCents: "9900" } } } };
    await handleVerifiedEvent(evt, deps);
    const credit = await store.getCredit("qfs_lead_credit");
    expect(credit?.used).toBe(true);
    expect(credit?.usedOnOfferId).toBe(stored.offerId);
    // A second consume attempt is rejected (single-use).
    expect(await store.consumeCredit("qfs_lead_credit", "qfo_other")).toBe(false);
    expect((await store.getCredit("qfs_lead_credit"))?.usedOnOfferId).toBe(stored.offerId);
  });
});

describe("Fix Scan routing prefers the direct repair", () => {
  it("routes a confident, ready-to-sell fix to DIRECT_FIX, not the $99 scan", () => {
    expect(routeLead(gen()).route).toBe("DIRECT_FIX");
  });
});

describe("evergreen trust asset ops", () => {
  it("activates a version without regenerating offers; swap is safe", async () => {
    const now = "2026-09-08T00:00:00Z";
    await store.ensureEvergreenSeed(now);
    const draft = await store.addEvergreenDraft(now);
    await store.attachEvergreenAsset(draft.version, "https://cdn/explainer.mp4", 90, now);
    await store.activateEvergreen(draft.version, now);
    const versions = await store.getEvergreen();
    const active = selectActiveEvergreen(versions);
    expect(active?.version).toBe(draft.version);
    expect(active?.assetUrl).toBe("https://cdn/explainer.mp4");
    // Retiring the active version leaves offers untouched (they just pick the next active/draft).
    await store.retireEvergreen(draft.version, now);
    expect((await store.getEvergreen()).find((v) => v.version === draft.version)?.status).toBe("retired");
  });
});

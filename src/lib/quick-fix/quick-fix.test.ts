import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";

import { generateOffer } from "./offer-engine";
import type { OfferFinding, QuickFixOffer } from "./types";
import { classifyPricing } from "./pricing";
import { computeEconomics, DEFAULT_THRESHOLD } from "./economics";
import { assessEvidence, containsFabricatedClaim, isConcreteDefect } from "./evidence-gate";
import { assessFixability } from "./fixability";
import { listSkus, skuFor, defectSignatureIndex } from "./catalog";
import { eligibleForReinspection } from "./reinspection";
import type { CustomerRecord } from "./lifecycle";
import { validateOfferForPurchase } from "./purchase-safety";
import { buildStripeDescription } from "./stripe-copy";
import { buildCheckoutParams, toStripeForm, offerMetadata, reconcileOfferCheckout, type CommerceRecord, type CommerceStore, type StripeCheckoutClient } from "./stripe-commerce";
import { verifyStripeSignature, interpretEvent, handleVerifiedEvent, type WebhookDeps } from "./webhook";
import { canTransitionJob, initialJobStateAfterPayment, buildIntakeChecklist, needsIntake } from "./fulfillment";
import { buildRequirements, computeDeliveryClock, deliveryWindowHours } from "./requirements";
import { buildTermsAcceptance, termsAcceptanceMatchesOffer, TERMS_VERSION } from "./terms";
import { seedEvergreenExplainer, selectActiveEvergreen, CANONICAL_EXPLAINER_SCRIPT, type EvergreenAssetVersion } from "./evergreen-asset";
import { buildOfferPageModel } from "./offer-page";
import { onVerifiedPurchase } from "./lifecycle";
import { rankQuickCash, addressableTotals, scoreQuickCash } from "./quick-cash";
import { composeOfferOutreach, composeFollowUp } from "./offer-outreach";
import { playbookFor, canCompleteJob } from "./playbooks";
import { buildCompletionReport, proofUsage } from "./completion";
import { scoreIntent } from "./intent";
import { jobProfit, northStar, classifySku } from "./profitability";
import { baselinePriceVersions, isApprovedPrice, assignPriceVersion } from "./pricing-experiments";
import { nextBestFix } from "./next-best-fix";
import { FUNNEL_EVENTS } from "./lifecycle";
import { FIX_SCAN_SKU, routeLead, createCredit, applyCredit, buildFixScanReport, fixScanDownsellEligible } from "./fix-scan";

// ── Fixtures ─────────────────────────────────────────────────────────────────
const F = (over: Partial<OfferFinding>): OfferFinding => ({
  id: "f", category: "Customer Acquisition", observation: "x", whyItMatters: "y",
  confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://x"], ...over,
});

const CTA = F({ id: "cta", observation: "the primary CTA button is hard to find on mobile", category: "Customer Acquisition" });
const FORM = F({ id: "form", observation: "the contact form submission appears broken", category: "Communication" });
const META = F({ id: "meta", observation: "page titles are duplicate placeholder metadata", category: "Analytics" });
const CAPTURE = F({ id: "cap", observation: "no online booking so visitors can't schedule; the whole lead capture path is weak", category: "Customer Acquisition" });
const HOMEPAGE = F({ id: "home", observation: "the homepage hero doesn't state the value proposition above the fold", category: "Brand Experience" });

const gen = (findings: OfferFinding[], over: Partial<Parameters<typeof generateOffer>[0]> = {}) =>
  generateOffer({ leadId: "lead_1", companyName: "Acme Roofing", findings, generatedAt: null, ...over });

// ── Pricing (deterministic; LLM cannot price) ──────────────────────────────────
describe("deterministic pricing", () => {
  it("$249 ENTRY: one small fix", () => {
    const o = gen([CTA]);
    expect(o.quickFixEligible).toBe(true);
    expect(o.band).toBe("ENTRY");
    expect(o.priceCents).toBe(24900);
  });
  it("$495 GROWTH: several related changes", () => {
    const o = gen([CTA, FORM, META]);
    expect(o.band).toBe("GROWTH");
    expect(o.priceCents).toBe(49500);
    expect(o.capabilityKeys.length).toBe(3);
  });
  it("$995 MINI: broader productized fix", () => {
    const o = gen([CAPTURE]);
    expect(o.band).toBe("MINI");
    expect(o.priceCents).toBe(99500);
  });
  it("classifier routes >ceiling work to a conversation, not an artificial tier", () => {
    const d = classifyPricing({ estimatedHours: 15.5, changeCount: 2, maxRisk: "medium", requiresDiscovery: false, scopeUncertain: false });
    expect(d.quickFixEligible).toBe(false);
    expect(d.band).toBeNull();
  });
  it("an LLM cannot alter the amount — price is a pure function of the band", () => {
    const o = gen([CTA]);
    // Even if a caller personalizes copy, the price is unchanged.
    const o2 = gen([CTA], { copy: { offerName: "Super Deluxe Fix", proposedSolution: "we will make it great" } });
    expect(o2.priceCents).toBe(o.priceCents);
    expect(o2.scope.offerName).toBe("Super Deluxe Fix");
  });
});

// ── Evidence gate (no fabrication) ─────────────────────────────────────────────
describe("evidence gate", () => {
  it("declines with no provenance", () => {
    const a = assessEvidence([F({ confidenceLabel: "Unknown", confidenceScore: 0, basis: [] })]);
    expect(a.sufficientForOffer).toBe(false);
    expect(a.recommendation).toBe("DECLINE");
  });
  it("softens to a diagnostic CTA below the confidence floor", () => {
    const a = assessEvidence([F({ confidenceLabel: "Inferred", confidenceScore: 0.4, observation: "the contact form submission appears broken" })]);
    expect(a.sufficientForOffer).toBe(false);
    expect(a.recommendation).toBe("SOFT_DIAGNOSTIC");
  });
  it("insufficient evidence yields a non-eligible offer", () => {
    const o = gen([F({ confidenceLabel: "Unknown", confidenceScore: 0, basis: [] })]);
    expect(o.quickFixEligible).toBe(false);
    expect(o.notEligibleReason).toBeTruthy();
  });
  it("flags fabricated business-impact claims", () => {
    expect(containsFabricatedClaim("You are losing $10,000/month")).toBe(true);
    expect(containsFabricatedClaim("this will increase conversions 40%")).toBe(true);
    expect(containsFabricatedClaim("we noticed your CTA is hard to find")).toBe(false);
  });
  it("OBSERVED phrasing differs from INFERRED phrasing", () => {
    const o = gen([CTA]);
    expect(o.scope.problemBeingSolved).toMatch(/we noticed/i);
    expect(o.evidenceGrade).toBe("OBSERVED");
  });
});

// ── Capability + lineage + version ─────────────────────────────────────────────
describe("capability + lineage", () => {
  it("offer is tied to its source findings + capabilities", () => {
    const o = gen([CTA, FORM]);
    expect(o.findingIds).toEqual(expect.arrayContaining(["cta", "form"]));
    expect(o.capabilityKeys.length).toBeGreaterThan(0);
  });
  it("irrelevant unmatched findings do not fabricate an offer", () => {
    const weird = F({ id: "w", observation: "the owner is very tall", category: "Operations" });
    const o = gen([weird]);
    expect(o.quickFixEligible).toBe(false);
  });
  it("offerVersion is a stable hash of price-relevant inputs", () => {
    expect(gen([CTA]).offerVersion).toBe(gen([CTA]).offerVersion);
    expect(gen([CTA]).offerVersion).not.toBe(gen([CAPTURE]).offerVersion);
  });
  it("a business with NO functioning website cannot be sold a website fix", () => {
    const o = gen([CTA], { hasWebsite: false });
    expect(o.quickFixEligible).toBe(false);
    expect(o.notEligibleReason).toMatch(/no functioning website/i);
  });
  it("a 'no website' finding never anchors a website fix (defense in depth)", () => {
    const noSite = F({ id: "ns", observation: "the business has no owned website — only a Google Business listing", category: "Customer Acquisition" });
    // Even with hasWebsite defaulting true, this finding must not match a capability.
    const o = gen([noSite]);
    expect(o.quickFixEligible).toBe(false);
  });
});

// ── Economics / margin guardrail ───────────────────────────────────────────────
describe("economics guardrail", () => {
  it("rejects an economically poor offer", () => {
    const e = computeEconomics({ priceCents: 25000, estimatedHours: 6, externalCostCents: 0, deliveryRisk: "low", supportBurden: "low" }, DEFAULT_THRESHOLD);
    expect(e.clearsMarginGate).toBe(false); // $250 / 6h = ~$42/hr
  });
  it("passes an efficient offer", () => {
    const e = computeEconomics({ priceCents: 49500, estimatedHours: 5, externalCostCents: 0, deliveryRisk: "low", supportBurden: "low" }, DEFAULT_THRESHOLD);
    expect(e.clearsMarginGate).toBe(true); // $99/hr
  });
});

// ── Purchase safety validator ──────────────────────────────────────────────────
describe("validateOfferForPurchase", () => {
  const ok = (o: QuickFixOffer) => validateOfferForPurchase({ offer: o, approved: true, stripeConfigured: true, superseded: false, leadBlocked: false });
  it("passes a complete approved offer", () => {
    expect(ok(gen([CTA])).ok).toBe(true);
  });
  it("rejects a price tampered away from the canonical tier", () => {
    const o = { ...gen([CTA]), priceCents: 30000 };
    const r = ok(o);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not an approved version/);
  });
  it("rejects when not approved / superseded / blocked / no stripe", () => {
    const o = gen([CTA]);
    expect(validateOfferForPurchase({ offer: o, approved: false, stripeConfigured: true, superseded: false, leadBlocked: false }).ok).toBe(false);
    expect(validateOfferForPurchase({ offer: o, approved: true, stripeConfigured: true, superseded: true, leadBlocked: false }).ok).toBe(false);
    expect(validateOfferForPurchase({ offer: o, approved: true, stripeConfigured: true, superseded: false, leadBlocked: true }).ok).toBe(false);
    expect(validateOfferForPurchase({ offer: o, approved: true, stripeConfigured: false, superseded: false, leadBlocked: false }).ok).toBe(false);
  });
  it("a non-eligible offer cannot be purchased", () => {
    expect(ok(gen([F({ confidenceLabel: "Unknown", confidenceScore: 0, basis: [] })])).ok).toBe(false);
  });
});

// ── Stripe commerce mapping + idempotency ──────────────────────────────────────
describe("stripe commerce", () => {
  it("metadata traces to lead/offer/version/tier", () => {
    const o = { ...gen([CTA]), offerId: "offer_1" };
    const m = offerMetadata(o, "one_time");
    expect(m).toMatchObject({ leadId: "lead_1", offerId: "offer_1", pricingBand: "ENTRY", offerVersion: o.offerVersion });
  });
  it("one-time → mode=payment; with maintenance → mode=subscription with a recurring line", () => {
    const o = { ...gen([CTA]), offerId: "offer_1" };
    expect(buildCheckoutParams(o, { withMaintenance: false, baseUrl: "https://app.test" }).mode).toBe("payment");
    const sub = buildCheckoutParams(o, { withMaintenance: true, baseUrl: "https://app.test" });
    expect(sub.mode).toBe("subscription");
    expect(sub.lineItems.some((l) => l.recurringInterval === "month")).toBe(true);
  });
  it("form encodes line items + metadata for Stripe", () => {
    const o = { ...gen([CTA]), offerId: "offer_1" };
    const form = toStripeForm(buildCheckoutParams(o, { withMaintenance: false, baseUrl: "https://app.test" }));
    expect(form["line_items[0][price_data][unit_amount]"]).toBe("24900");
    expect(form["metadata[offerId]"]).toBe("offer_1");
  });
  it("reconcile reuses the same version and supersedes older ones (no catalog explosion)", async () => {
    let creates = 0;
    const client: StripeCheckoutClient = { async create() { creates += 1; return { ok: true, id: `sess_${creates}`, url: `https://pay/${creates}` }; } };
    const db = new Map<string, CommerceRecord>();
    const store: CommerceStore = {
      async get(k) { return db.get(k) ?? null; },
      async listForOffer(id) { return [...db.values()].filter((r) => r.offerId === id); },
      async put(r) { db.set(r.key, r); },
    };
    const o1 = { ...gen([CTA]), offerId: "offer_1" };
    const a = await reconcileOfferCheckout({ offer: o1, kind: "one_time", client, store, baseUrl: "https://app.test", now: "t0" });
    const b = await reconcileOfferCheckout({ offer: o1, kind: "one_time", client, store, baseUrl: "https://app.test", now: "t0" });
    expect(a.reused).toBe(false);
    expect(b.reused).toBe(true);
    expect(creates).toBe(1); // idempotent

    const o2 = { ...o1, offerVersion: "changedversion00" }; // material change
    const c = await reconcileOfferCheckout({ offer: o2, kind: "one_time", client, store, baseUrl: "https://app.test", now: "t1" });
    expect(c.reused).toBe(false);
    expect(creates).toBe(2);
    // Old version is superseded.
    const old = [...db.values()].find((r) => r.offerVersion === o1.offerVersion)!;
    expect(old.superseded).toBe(true);
  });
});

// ── Webhook: verified, idempotent, replay-safe ────────────────────────────────
describe("stripe webhook", () => {
  const secret = "whsec_test";
  const sign = (payload: string, t: number) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;

  it("verifies a good signature and rejects a bad one / replay", () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const t = 1_000_000;
    expect(verifyStripeSignature({ payload, header: sign(payload, t), secret, nowSec: t + 10 }).ok).toBe(true);
    expect(verifyStripeSignature({ payload, header: sign(payload, t), secret, nowSec: t + 10, toleranceSec: 300 }).ok).toBe(true);
    expect(verifyStripeSignature({ payload, header: `t=${t},v1=deadbeef`, secret, nowSec: t + 10 }).ok).toBe(false);
    expect(verifyStripeSignature({ payload, header: sign(payload, t), secret, nowSec: t + 10_000 }).ok).toBe(false); // replay
  });

  it("browser redirect success (unpaid session) does NOT mark paid", () => {
    const out = interpretEvent({ id: "e", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "unpaid", metadata: { offerId: "offer_1" } } } });
    expect(out.kind).toBe("ignored");
  });

  it("a paid session yields payment_succeeded; duplicate events are idempotent", async () => {
    const event = { id: "evt_paid", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", subscription: null, metadata: { offerId: "offer_1", leadId: "lead_1", offerVersion: "v1" } } } };
    const processed = new Set<string>();
    let paidApplies = 0;
    const deps: WebhookDeps = {
      async alreadyProcessed(id) { return processed.has(id); },
      async markProcessed(id) { processed.add(id); },
      async applyPaid() { paidApplies += 1; },
      async applySubscription() {},
    };
    const r1 = await handleVerifiedEvent(event, deps);
    const r2 = await handleVerifiedEvent(event, deps);
    expect(r1.outcome.kind).toBe("payment_succeeded");
    expect(r2.duplicate).toBe(true);
    expect(paidApplies).toBe(1); // job created exactly once
  });

  it("maps subscription lifecycle states", () => {
    const out = interpretEvent({ id: "e", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled", metadata: { offerId: "offer_1" } } } });
    expect(out).toMatchObject({ kind: "subscription_changed", state: "CANCELED" });
  });
});

// ── Fulfillment + intake ───────────────────────────────────────────────────────
describe("fulfillment + intake", () => {
  it("job state machine allows valid and blocks invalid transitions", () => {
    expect(canTransitionJob("PAID", "WAITING_FOR_CUSTOMER_INPUT")).toBe(true);
    expect(canTransitionJob("PAID", "COMPLETE")).toBe(false);
    expect(canTransitionJob("IN_PROGRESS", "QA")).toBe(true);
  });
  it("payment with outstanding intake waits for the customer", () => {
    expect(initialJobStateAfterPayment(true)).toBe("WAITING_FOR_CUSTOMER_INPUT");
    expect(initialJobStateAfterPayment(false)).toBe("READY_FOR_FULFILLMENT");
  });
  it("intake asks only for needed access and never a password", () => {
    const o = { ...gen([CTA]), offerId: "offer_1" };
    expect(needsIntake(o)).toBe(true);
    const list = buildIntakeChecklist(o);
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((i) => i.secure === true)).toBe(true);
    expect(list.securityNote).toMatch(/never ask for your password/i);
  });
});

// ── Requirements + delivery clock ──────────────────────────────────────────────
describe("requirements + delivery clock", () => {
  it("classifies necessity and generates actionable steps", () => {
    const r = buildRequirements({ ...gen([CTA]), offerId: "offer_1" });
    expect(r.items.some((i) => i.necessity === "REQUIRED_BEFORE_START")).toBe(true);
    expect(r.items.some((i) => i.necessity === "OPTIONAL")).toBe(true);
    expect(r.items.some((i) => i.necessity === "ONLY_IF_NEEDED")).toBe(true);
    expect(r.blockingCount).toBeGreaterThan(0);
  });
  it("delivery clock does NOT start until requirements are received", () => {
    const o = gen([CTA]);
    const waiting = computeDeliveryClock({ offer: o, purchasedAt: "2026-01-01T00:00:00.000Z", requirementsReceivedAt: null });
    expect(waiting.fulfillmentClockStartedAt).toBeNull();
    expect(waiting.targetDeliveryAt).toBeNull();
    const started = computeDeliveryClock({ offer: o, purchasedAt: "2026-01-01T00:00:00.000Z", requirementsReceivedAt: "2026-01-02T00:00:00.000Z" });
    expect(started.targetDeliveryAt).not.toBeNull();
    expect(deliveryWindowHours(o)).toBe(24);
  });
});

// ── Terms tied to offer version ────────────────────────────────────────────────
describe("terms", () => {
  it("acceptance is bound to the exact offer version", () => {
    const o = { ...gen([CTA]), offerId: "offer_1" };
    const acc = buildTermsAcceptance({ offer: o, customerEmail: "b@x.com", acceptedAt: "t" });
    expect(acc.termsVersion).toBe(TERMS_VERSION);
    expect(termsAcceptanceMatchesOffer(acc, o)).toBe(true);
    expect(termsAcceptanceMatchesOffer(acc, { ...o, offerVersion: "different" })).toBe(false);
  });
});

// ── Evergreen trust video reuse ────────────────────────────────────────────────
describe("evergreen trust video", () => {
  it("seeds a single reusable explainer with the canonical script", () => {
    const seed = seedEvergreenExplainer("t");
    expect(seed.role).toBe("ARTIFEX_QUICK_FIX_EXPLAINER");
    expect(seed.script).toBe(CANONICAL_EXPLAINER_SCRIPT);
    expect(seed.status).toBe("draft");
  });
  it("selects the latest active version; is reused across offers", () => {
    const v1: EvergreenAssetVersion = { ...seedEvergreenExplainer("t"), version: 1, status: "active", assetUrl: "u1" };
    const v2: EvergreenAssetVersion = { ...seedEvergreenExplainer("t"), version: 2, status: "active", assetUrl: "u2" };
    const active = selectActiveEvergreen([v1, v2]);
    expect(active?.version).toBe(2);
    // The SAME asset object feeds two different offers' pages (not regenerated).
    const pageA = buildOfferPageModel({ offer: { ...gen([CTA]), offerId: "A" }, evergreen: active, approved: true, stripeConfigured: true, termsAccepted: true, superseded: false, bookingUrl: "https://cal" });
    const pageB = buildOfferPageModel({ offer: { ...gen([CAPTURE]), offerId: "B" }, evergreen: active, approved: true, stripeConfigured: true, termsAccepted: true, superseded: false, bookingUrl: "https://cal" });
    expect(pageA.trustVideo.version).toBe(2);
    expect(pageB.trustVideo.version).toBe(2);
  });
  it("swapping the active version does not touch the offer", () => {
    const o = gen([CTA]);
    const before = o.offerVersion;
    const v3: EvergreenAssetVersion = { ...seedEvergreenExplainer("t"), version: 3, status: "active", assetUrl: "u3" };
    buildOfferPageModel({ offer: o, evergreen: v3, approved: true, stripeConfigured: true, termsAccepted: true, superseded: false, bookingUrl: "https://cal" });
    expect(o.offerVersion).toBe(before); // unchanged
  });
});

// ── Offer page model ───────────────────────────────────────────────────────────
describe("offer page", () => {
  const page = (o: QuickFixOffer, over: any = {}) => buildOfferPageModel({ offer: o, evergreen: { ...seedEvergreenExplainer("t"), status: "active", assetUrl: "u", version: 1 }, approved: true, stripeConfigured: true, termsAccepted: true, superseded: false, bookingUrl: "https://cal", ...over });
  it("renders personalized finding, price, scope, requirements, and the evergreen video", () => {
    const p = page({ ...gen([CTA]), offerId: "offer_1" });
    expect(p.whatWeFound).toMatch(/we noticed/i);
    expect(p.priceLabel).toBe("$249 flat");
    expect(p.whatWeFix.length).toBeGreaterThan(0);
    expect(p.requirements.items.length).toBeGreaterThan(0);
    expect(p.trustVideo.present).toBe(true);
    expect(p.checkout.buyEnabled).toBe(true);
  });
  it("buy is disabled without stripe or without accepted terms", () => {
    expect(page({ ...gen([CTA]), offerId: "o" }, { stripeConfigured: false }).checkout.buyEnabled).toBe(false);
    expect(page({ ...gen([CTA]), offerId: "o" }, { termsAccepted: false }).checkout.buyEnabled).toBe(false);
  });
  it("a non-productizable offer is a conversation page, not a sales page", () => {
    const p = page(gen([CAPTURE, HOMEPAGE]));
    expect(p.conversationOnly).toBe(true);
    expect(p.checkout.purchasable).toBe(false);
  });
});

// ── Lifecycle ──────────────────────────────────────────────────────────────────
describe("lifecycle", () => {
  it("first verified purchase turns a prospect into a customer and stops cold outreach", () => {
    const r = onVerifiedPurchase(null, { leadId: "lead_1", email: "b@x.com", offerId: "offer_1", amountCents: 25000, at: "t", maintenancePlanKey: null });
    expect(r.transition.becomesCustomer).toBe(true);
    expect(r.transition.stopColdOutreach).toBe(true);
    expect(r.record.lifetimeRevenueCents).toBe(25000);
  });
});

// ── Quick-cash queue ───────────────────────────────────────────────────────────
describe("quick-cash queue", () => {
  it("ranks eligible offers ahead of ineligible and by score", () => {
    const eligible = gen([CTA]);
    const ineligible = gen([F({ confidenceLabel: "Unknown", confidenceScore: 0, basis: [] })]);
    const rows = rankQuickCash([ineligible, eligible]);
    expect(rows[0].eligible).toBe(true);
    expect(scoreQuickCash(eligible)).toBeGreaterThan(0);
    expect(scoreQuickCash(ineligible)).toBe(0);
  });
  it("sums addressable low-ticket opportunity by tier", () => {
    const t = addressableTotals([gen([CTA]), gen([CAPTURE]), gen([F({ confidenceLabel: "Unknown", confidenceScore: 0, basis: [] })])]);
    expect(t.entry.count).toBe(1);
    expect(t.mini.count).toBe(1);
    expect(t.ineligibleCount).toBe(1);
    expect(t.eligibleTotalCents).toBe(24900 + 99500);
  });
});

// ── Broken-thing hunter: concrete defects, fixability, SKU catalog ─────────────
describe("broken-thing hunter", () => {
  const VAGUE = F({ id: "v", observation: "their website could be better and their branding could use work", category: "Brand Experience" });
  it("a vague opportunity does NOT qualify as a quick fix", () => {
    expect(isConcreteDefect("their website could be better")).toBe(false);
    expect(isConcreteDefect("the contact form submission does not complete on mobile")).toBe(true);
    const o = gen([VAGUE]);
    expect(o.quickFixEligible).toBe(false);
    expect(assessFixability(o).state).toBe("NO_FIX_FOUND");
  });
  it("a concrete defect with evidence qualifies and is READY_TO_SELL", () => {
    const fix = assessFixability(gen([FORM]));
    expect(fix.state).toBe("READY_TO_SELL");
    expect(fix.readyToSell).toBe(true);
    expect(fix.matchedSku).toBe("contact-form-repair");
  });
  it("Fixability Score is explainable (weighted components)", () => {
    const fix = assessFixability(gen([CTA]));
    expect(fix.components.length).toBeGreaterThanOrEqual(6);
    expect(fix.components.map((c) => c.key)).toEqual(expect.arrayContaining(["evidence", "skuMatch", "margin", "speed"]));
    const weight = fix.components.reduce((s, c) => s + c.weight, 0);
    expect(Math.round(weight * 100) / 100).toBe(1); // weights sum to 1
    expect(fix.score).toBeGreaterThan(0);
  });
  it("no-website / too-big work routes to CONVERSATION_REQUIRED, not the funnel", () => {
    expect(assessFixability(gen([CTA], { hasWebsite: false })).state).toBe("CONVERSATION_REQUIRED");
    expect(assessFixability(gen([CAPTURE, HOMEPAGE])).state).toBe("CONVERSATION_REQUIRED");
  });
  it("a ready-to-sell $249 fix outranks a vague/too-big project", () => {
    const rows = rankQuickCash([gen([CAPTURE, HOMEPAGE]), gen([VAGUE]), gen([CTA])]);
    expect(rows[0].readyToSell).toBe(true);
    expect(rows[0].band).toBe("ENTRY");
  });
  it("the catalog exposes SKUs with fixed SLA (LLM cannot alter SLA) + defect signatures", () => {
    expect(skuFor("cta-repair")?.slaLabel).toBe("24 hours");
    expect(listSkus().length).toBeGreaterThan(0);
    const idx = defectSignatureIndex();
    expect(idx["form-submit-fails"]).toContain("contact-form-repair"); // SKU-aware discovery
  });
});

// ── Reinspection cooldown ──────────────────────────────────────────────────────
describe("reinspection", () => {
  const cust = (lastDeliveredAt: string | null): CustomerRecord => ({ leadId: "l", email: "e", firstPurchaseAt: "t", firstPurchaseType: "REPAIR", lifetimeRevenueCents: 25000, offersPurchased: ["o"], maintenancePlanKey: null, lastDeliveredAt, nextOpportunity: null, referralSource: null });
  it("respects the cooldown before re-inspecting", () => {
    const day = 86_400_000;
    const delivered = new Date(1_000_000 * day).toISOString();
    const now = 1_000_000 * day;
    expect(eligibleForReinspection(cust(delivered), now + 10 * day).eligible).toBe(false); // 10 < 45
    expect(eligibleForReinspection(cust(delivered), now + 50 * day).eligible).toBe(true);
    expect(eligibleForReinspection(cust(null), now).eligible).toBe(false);
  });
});

// ── Post-sale: playbooks, completion, consent, intent, profit, pricing, NBF ────
describe("fulfillment playbooks", () => {
  it("every sellable SKU has a QA-gated playbook", () => {
    for (const sku of listSkus()) {
      const pb = playbookFor(sku.key);
      expect(pb, sku.key).not.toBeNull();
      expect(pb!.qaChecklist.length).toBeGreaterThan(0);
      expect(pb!.steps.length).toBeGreaterThan(0);
    }
  });
  it("a job cannot complete until every QA item passes", () => {
    const pb = playbookFor("contact-form-repair")!;
    const partial: Record<string, boolean> = {};
    pb.qaChecklist.slice(0, 2).forEach((q) => (partial[q] = true));
    expect(canCompleteJob(pb, partial).ok).toBe(false);
    const all: Record<string, boolean> = {};
    pb.qaChecklist.forEach((q) => (all[q] = true));
    expect(canCompleteJob(pb, all).ok).toBe(true);
  });
});

describe("completion proof + consent", () => {
  it("completion report requires real before/after evidence; no fabricated metrics", () => {
    const o = { ...gen([FORM]), offerId: "o" };
    expect(buildCompletionReport(o, { beforeRef: null, afterRef: null, verification: [] }, "t").valid).toBe(false);
    const good = buildCompletionReport(o, { beforeRef: "b.png", afterRef: "a.png", verification: ["Desktop", "Mobile", "Submission received"] }, "t");
    expect(good.valid).toBe(true);
    expect(good.changes.length).toBeGreaterThan(0);
  });
  it("customer proof is not public without permission", () => {
    expect(proofUsage("NOT_REQUESTED").public).toBe(false);
    expect(proofUsage("REQUESTED").public).toBe(false);
    expect(proofUsage("DECLINED").public).toBe(false);
    expect(proofUsage("APPROVED_NAMED")).toEqual({ public: true, named: true });
    expect(proofUsage("APPROVED_ANONYMIZED")).toEqual({ public: true, named: false });
  });
});

describe("purchase intent (distinct from fixability)", () => {
  it("stronger measurable actions score strictly higher", () => {
    const open = scoreIntent({ events: [FUNNEL_EVENTS.emailOpened] }).score;
    const viewed = scoreIntent({ events: [FUNNEL_EVENTS.emailOpened, FUNNEL_EVENTS.offerPageViewed] }).score;
    const checkout = scoreIntent({ events: [FUNNEL_EVENTS.emailOpened, FUNNEL_EVENTS.offerPageViewed, FUNNEL_EVENTS.checkoutStarted] }).score;
    expect(viewed).toBeGreaterThan(open);
    expect(checkout).toBeGreaterThan(viewed);
  });
  it("abandoned checkout yields a non-spam reminder recommendation", () => {
    const r = scoreIntent({ events: [FUNNEL_EVENTS.checkoutStarted], checkoutAbandoned: true });
    expect(r.checkoutAbandoned).toBe(true);
    expect(r.recommendedNextStep).toMatch(/reminder/i);
  });
  it("no events → zero intent (nothing assumed)", () => {
    expect(scoreIntent({ events: [] }).score).toBe(0);
  });
});

describe("profitability (north star: gross profit per operator hour)", () => {
  it("uses actuals where present, null where not", () => {
    const untracked = jobProfit({ priceCents: 49500, externalCostCents: 0, refundCents: 0, operatorMinutes: null });
    expect(untracked.grossContributionCents).toBe(49500);
    expect(untracked.grossContributionPerOperatorHourCents).toBeNull(); // no time tracked
    const tracked = jobProfit({ priceCents: 49500, externalCostCents: 0, refundCents: 0, operatorMinutes: 180 });
    expect(tracked.grossContributionPerOperatorHourCents).toBe(16500); // $495 / 3h
  });
  it("north-star roll-up reports null operator hours when untracked", () => {
    const ns = northStar([{ priceCents: 25000, externalCostCents: 0, refundCents: 0, operatorMinutes: null }]);
    expect(ns.grossContributionCents).toBe(25000);
    expect(ns.operatorHours).toBeNull();
  });
  it("SKU verdict requires a sufficient sample (no small-sample calls)", () => {
    const base = { skuKey: "x", sales: 2, revenueCents: 50000, estimatedHours: 2, actualHours: 2, externalCostCents: 0, refundsCents: 0, grossContributionCents: 50000, effectiveHourlyCents: 25000, conversionRate: 0.1, repeatPurchaseRate: null, maintenanceAttachRate: null };
    expect(classifySku(base)).toBe("REVIEW"); // sales < 5
    expect(classifySku({ ...base, sales: 8 })).toBe("SCALE");
  });
});

describe("pricing versions (no LLM pricing, no auto-experiments)", () => {
  it("baseline versions are exactly the approved anchors and validate prices", () => {
    const v = baselinePriceVersions("t");
    expect(isApprovedPrice("ENTRY", 25000, v)).toBe(true);
    expect(isApprovedPrice("ENTRY", 29500, v)).toBe(false); // an unapproved price
    // With only baseline active, assignment is stable + deterministic.
    expect(assignPriceVersion("offer_1", "GROWTH", v)?.priceCents).toBe(49500);
  });
});

describe("next best fix (no re-selling completed work)", () => {
  it("excludes an already-delivered SKU unless the issue reappeared", () => {
    const formOffer = { ...gen([FORM]), offerId: "of" }; // contact-form-repair
    const ctaOffer = { ...gen([CTA]), offerId: "oc" }; // cta-repair
    const nbf = nextBestFix({ purchasedSkuKeys: ["contact-form-repair"], candidateOffers: [formOffer, ctaOffer] });
    expect(nbf.offer?.capabilityKeys).toContain("cta-repair");
    expect(nbf.offer?.capabilityKeys).not.toContain("contact-form-repair");
    // If it reappeared, it may be re-offered.
    const reappear = nextBestFix({ purchasedSkuKeys: ["contact-form-repair"], candidateOffers: [formOffer], reappearedSkuKeys: ["contact-form-repair"] });
    expect(reappear.offer).not.toBeNull();
  });
});

describe("SKU-specific follow-up", () => {
  it("references the exact SKU + price and never invents scope", () => {
    const o = { ...gen([FORM]), offerId: "o" };
    const fu = composeFollowUp(o, { buyUrl: "/offer/o", bookingUrl: "https://cal" }, { offerViewed: true, checkoutStarted: false });
    expect(fu.bodyText).toContain(o.scope.offerName);
    expect(fu.bodyText).toMatch(/\$\d+ flat/);
    expect(fu.safe).toBe(true);
    expect(fu.bodyText).not.toMatch(/just following up/i);
  });
});

// ── Fix Scan ($99 diagnostic) + pricing psychology + credit + routing ──────────
describe("fix scan + pricing psychology", () => {
  it("new baseline is $249/$495/$995; historical $250 preserved as a retired version", () => {
    const v = baselinePriceVersions("t");
    expect(isApprovedPrice("ENTRY", 24900, v)).toBe(true); // active $249
    expect(isApprovedPrice("ENTRY", 25000, v)).toBe(true); // retired legacy $250 still approved
    expect(isApprovedPrice("GROWTH", 49500, v)).toBe(true);
    expect(isApprovedPrice("MINI", 99500, v)).toBe(true);
    // A historical $250 offer still validates for purchase (not mutated to $249).
    const legacy = { ...gen([CTA]), priceCents: 25000, offerId: "legacy" };
    expect(validateOfferForPurchase({ offer: legacy, approved: true, stripeConfigured: true, superseded: false, leadBlocked: false }).ok).toBe(true);
  });
  it("Fix Scan is a fixed $99 SKU the LLM cannot change", () => {
    expect(FIX_SCAN_SKU.priceCents).toBe(9900);
    expect(FIX_SCAN_SKU.key).toBe("artifex-fix-scan");
    expect(FIX_SCAN_SKU.creditWindowDays).toBe(14);
    expect(FIX_SCAN_SKU.scope.excludes.join(" ")).toMatch(/redesign|strategy/i);
  });
  it("DIRECT FIX wins when evidence is sufficient (no cannibalization)", () => {
    const r = routeLead(gen([CTA]));
    expect(r.route).toBe("DIRECT_FIX");
  });
  it("Fix Scan when evidence is promising but insufficient", () => {
    const soft = gen([F({ id: "s", observation: "the contact form submission appears broken", confidenceLabel: "Inferred", confidenceScore: 0.45 })]);
    expect(soft.quickFixEligible).toBe(false);
    expect(routeLead(soft).route).toBe("FIX_SCAN");
  });
  it("large/custom → conversation, not Fix Scan; nothing concrete → no fix", () => {
    expect(routeLead(gen([CAPTURE, HOMEPAGE])).route).toBe("CONVERSATION_REQUIRED");
    expect(routeLead(gen([CTA], { hasWebsite: false })).route).toBe("CONVERSATION_REQUIRED");
    expect(routeLead(gen([F({ id: "v", observation: "their website could be better", category: "Brand Experience" })])).route).toBe("NO_FIX_FOUND");
  });
  it("cannibalization flag fires if a direct-eligible lead is pushed to a scan", () => {
    const r = routeLead(gen([CTA]), { prospectRequestedScan: true });
    expect(r.route).toBe("DIRECT_FIX"); // still sells the repair
    expect(r.cannibalizationFlag).toBe(true); // but flags the misroute
  });
  it("$99 credit is single-use, expiring, and never exceeds the repair price", () => {
    const delivered = new Date(1000 * 86_400_000).toISOString();
    const credit = createCredit("scan_1", delivered);
    const within = 1000 * 86_400_000 + 5 * 86_400_000;
    const applied = applyCredit(credit, 24900, "repair_1", within);
    expect(applied.applies).toBe(true);
    expect(applied.creditAppliedCents).toBe(9900);
    expect(applied.finalPriceCents).toBe(15000); // $249 - $99
    // Never exceeds a cheaper repair.
    expect(applyCredit(credit, 5000, "r", within).creditAppliedCents).toBe(5000);
    // Expired.
    expect(applyCredit(credit, 24900, "r", 1000 * 86_400_000 + 20 * 86_400_000).applies).toBe(false);
    // Already used.
    expect(applyCredit({ ...credit, used: true }, 24900, "r", within).applies).toBe(false);
  });
  it("Fix Scan report uses approved SKUs, requires evidence, rejects vague", () => {
    const report = buildFixScanReport([FORM, F({ id: "vague", observation: "could be better", basis: ["x"] })], "2026-10-01");
    expect(report.valid).toBe(true);
    expect(report.items.length).toBe(1); // vague rejected
    expect(report.items[0].matchedSku).toBe("contact-form-repair");
    expect(report.creditNote).toMatch(/\$99 Fix Scan credit/);
  });
  it("downsell is lifecycle-gated (engaged, not purchased, cooldown passed)", () => {
    expect(fixScanDownsellEligible({ offerViewed: true, purchased: false, optedOut: false, daysSinceOffer: 5 })).toBe(true);
    expect(fixScanDownsellEligible({ offerViewed: true, purchased: false, optedOut: false, daysSinceOffer: 1 })).toBe(false);
    expect(fixScanDownsellEligible({ offerViewed: true, purchased: true, optedOut: false, daysSinceOffer: 9 })).toBe(false);
    expect(fixScanDownsellEligible({ offerViewed: false, purchased: false, optedOut: false, daysSinceOffer: 9 })).toBe(false);
  });
  it("a Fix Scan purchase records the customer as first-purchase FIX_SCAN", () => {
    const r = onVerifiedPurchase(null, { leadId: "l", email: "e", offerId: "scan_1", amountCents: 9900, at: "t", maintenancePlanKey: null, purchaseType: "FIX_SCAN" });
    expect(r.record.firstPurchaseType).toBe("FIX_SCAN");
    expect(r.transition.becomesCustomer).toBe(true);
  });
});

// ── First-touch outreach (pure; does not send) ─────────────────────────────────
// Reworked: evidence-first / value-before-price. No price + no "Get this fixed"
// price-CTA in the default body; friendly link LABELS only; the primary CTA stays
// PURCHASE. (Deep first-touch coverage lives in offer-outreach-first-touch.test.ts.)
describe("offer outreach", () => {
  it("eligible offer → evidence-first teaser, PURCHASE CTA, no price, no fabricated claims", () => {
    const c = composeOfferOutreach({ ...gen([CTA]), offerId: "offer_1" }, { buyUrl: "https://app/offer/offer_1", bookingUrl: "https://cal" });
    expect(c.primaryCta).toBe("PURCHASE");
    // No price / no old price-CTA copy in the default first-touch body.
    expect(c.bodyText).not.toMatch(/Get this fixed/);
    expect(c.bodyText).not.toMatch(/\$\s?\d/);
    // Friendly click label + book-a-conversation option present.
    expect(c.bodyText).toMatch(/See what I found →|Watch the website review →/);
    expect(c.bodyText).toMatch(/book a conversation/i);
    expect(c.safe).toBe(true);
  });
  it("non-eligible offer → conversation only, no purchase CTA", () => {
    const c = composeOfferOutreach(gen([CAPTURE, HOMEPAGE]), { buyUrl: "x", bookingUrl: "https://cal" });
    expect(c.primaryCta).toBe("BOOK_A_CONVERSATION");
    expect(c.bodyText).not.toMatch(/Get this fixed/);
  });
});

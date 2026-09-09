// ─────────────────────────────────────────────────────────────────────────────
// OPERATOR VIEWS — read-only models for the Acquisition OS revenue surfaces:
// Quick-Cash, High-Intent, Ready-for-Fulfillment, Catalog, Profitability, CLV.
// Derives from stored state + the BI evidence spine. Honest empty/null states —
// never fabricates events, economics, or customers. No charges, no sends.
// ─────────────────────────────────────────────────────────────────────────────
import { listLeads, getBusinessIntelligence, listAudit, buildSuppressionChecker } from "../repo";
import { buildOfferForLead } from "./adapter";
import { rankQuickCash, addressableTotals, type QuickCashRow } from "./quick-cash";
import { routeLead } from "./fix-scan";
import { scoreIntent } from "./intent";
import { northStar, classifySku, jobProfit, type JobEconomicsActuals } from "./profitability";
import { listSkus, skuFor } from "./catalog";
import { FIX_SCAN_SKU } from "./fix-scan";
import { baselinePriceVersions } from "./pricing-experiments";
import { capabilityByKey } from "./capabilities";
import { playbookFor } from "./playbooks";
import { DEFAULT_AUTOMATION_LEVEL, AUTO_ELIGIBLE_CAPABILITY_ALLOWLIST } from "./automation-policy";
import * as store from "./store";
import type { QuickFixOffer } from "./types";

// ── Build fresh offers from the current lead inventory (same path as the dry-run) ─
export async function buildLeadOffers(limit = 500): Promise<QuickFixOffer[]> {
  const leads = await listLeads();
  const offers: QuickFixOffer[] = [];
  for (const lead of leads.slice(0, limit)) {
    const bi = await getBusinessIntelligence(lead.id).catch(() => null);
    const profile = (bi?.profile as any)?.businessProfile ?? null;
    if (!profile) continue;
    const opps = Array.isArray(profile.opportunities) ? profile.opportunities : [];
    offers.push(buildOfferForLead({ leadId: lead.id, companyName: (lead as any).businessName ?? lead.id, opportunities: opps, website: (lead as any).website, generatedAt: null }));
  }
  return offers;
}

export interface QuickCashView {
  rows: QuickCashRow[];
  totals: ReturnType<typeof addressableTotals>;
  routing: { DIRECT_FIX: number; FIX_SCAN: number; CONVERSATION_REQUIRED: number; NO_FIX_FOUND: number; cannibalization: number };
}

export async function quickCashView(limit = 500): Promise<QuickCashView> {
  const offers = await buildLeadOffers(limit);
  const rows = rankQuickCash(offers);
  const totals = addressableTotals(offers);
  const routing = { DIRECT_FIX: 0, FIX_SCAN: 0, CONVERSATION_REQUIRED: 0, NO_FIX_FOUND: 0, cannibalization: 0 };
  for (const o of offers) {
    const r = routeLead(o);
    routing[r.route] += 1;
    if (r.cannibalizationFlag) routing.cannibalization += 1;
  }
  return { rows, totals, routing };
}

// ── Quick-Cash inventory — reclassify the whole non-customer lead inventory ──────
// Every non-customer lead resolves to EXACTLY ONE route via routeLead(). Customers
// are excluded from selling routes (they get next-best-fix, never cold). Scheduled
// legacy cold bindings are reported as LEGACY_FROZEN (inert while the cold path is
// frozen — preserved, never sent, never deleted). Read-only; no sends, no charges.
export interface QuickCashInventory {
  totalLeads: number;
  customers: number;
  suppressed: number;
  legacyFrozenScheduled: number;
  routes: { DIRECT_FIX: number; FIX_SCAN: number; CONVERSATION_REQUIRED: number; NO_FIX_FOUND: number };
  readyToSell: number;
  addressableRevenueCents: number;
  coldOutreachFrozen: boolean;
  /** Every non-customer lead is counted under exactly one route (invariant check). */
  exactlyOneRoutePerLead: boolean;
}

export async function quickCashInventory(opts: { limit?: number; offers?: QuickFixOffer[] } = {}): Promise<QuickCashInventory> {
  const { legacyColdOutreachFrozen } = await import("../outreach/legacy-freeze");
  const leads = await listLeads();
  const state = await store.getState();
  const customerLeadIds = new Set(Object.keys(state.customers));

  // Offers are built only for non-customer leads that have a BI profile; the rest
  // (no evidence) fall through to NO_FIX_FOUND so every lead is accounted for once.
  const built = opts.offers ?? (await buildLeadOffers(opts.limit ?? 1000));
  const offers = built.filter((o) => !customerLeadIds.has(o.leadId));
  const routedLeadIds = new Set(offers.map((o) => o.leadId));
  const routes = { DIRECT_FIX: 0, FIX_SCAN: 0, CONVERSATION_REQUIRED: 0, NO_FIX_FOUND: 0 };
  for (const o of offers) routes[routeLead(o).route] += 1;

  // Non-customer leads with no offer (no evidence / no profile) → NO_FIX_FOUND.
  const nonCustomerLeads = leads.filter((l) => !customerLeadIds.has(l.id));
  const unrouted = nonCustomerLeads.filter((l) => !routedLeadIds.has(l.id)).length;
  routes.NO_FIX_FOUND += unrouted;

  const rows = rankQuickCash(offers);
  const readyToSell = rows.filter((r) => r.readyToSell).length;
  const addressableRevenueCents = addressableTotals(offers).eligibleTotalCents;

  // Suppressed (best-effort by lead domain — a lead can be suppressed independent of route).
  const check = await buildSuppressionChecker();
  let suppressed = 0;
  for (const l of leads) {
    const site = (l as any).website as string | undefined;
    let domain: string | null = null;
    if (site) { try { domain = new URL(site.startsWith("http") ? site : `https://${site}`).hostname.replace(/^www\./, ""); } catch { domain = null; } }
    if (domain && check({ domain })) suppressed += 1;
  }

  const { listScheduledBindings } = await import("../outreach/scheduled-batch");
  const legacyFrozenScheduled = (await listScheduledBindings()).length;

  const routedTotal = routes.DIRECT_FIX + routes.FIX_SCAN + routes.CONVERSATION_REQUIRED + routes.NO_FIX_FOUND;
  return {
    totalLeads: leads.length,
    customers: customerLeadIds.size,
    suppressed,
    legacyFrozenScheduled,
    routes,
    readyToSell,
    addressableRevenueCents,
    coldOutreachFrozen: legacyColdOutreachFrozen(),
    exactlyOneRoutePerLead: routedTotal === nonCustomerLeads.length,
  };
}

// ── Quick-Cash HOME — the default operator workspace ("what can we sell now?"). ──
// Builds the lead offers ONCE and derives the ranked feed, inventory, and the money-
// loop metrics band from it (+ fulfillment/customers/intent). Read-only; honest
// empty states; no fabricated metrics; no sends; no charges.
const ACTIVE_FULFILLMENT_STATES = ["READY_FOR_FULFILLMENT", "IN_PROGRESS", "QA", "WAITING_FOR_CUSTOMER_INPUT", "PAID"];

export interface QuickCashHome {
  rows: QuickCashRow[];
  routing: QuickCashView["routing"];
  inventory: QuickCashInventory;
  metrics: {
    readyToSell: number;
    addressableRevenueCents: number;
    inFulfillment: number;
    customers: number;
    revenueCents: number;
    purchases: number;
    engaged: number;
    coldOutreachFrozen: boolean;
  };
}

export async function quickCashHomeView(limit = 500): Promise<QuickCashHome> {
  const offers = await buildLeadOffers(limit);
  const rows = rankQuickCash(offers);
  const routing = { DIRECT_FIX: 0, FIX_SCAN: 0, CONVERSATION_REQUIRED: 0, NO_FIX_FOUND: 0, cannibalization: 0 };
  for (const o of offers) { const r = routeLead(o); routing[r.route] += 1; if (r.cannibalizationFlag) routing.cannibalization += 1; }

  const inventory = await quickCashInventory({ offers });
  const fulfil = await fulfillmentView();
  const inFulfillment = ACTIVE_FULFILLMENT_STATES.reduce((n, s) => n + (fulfil.byState[s] ?? 0), 0);
  const customers = await customersView();
  const revenueCents = customers.reduce((n, c) => n + c.lifetimeRevenueCents, 0);
  const purchases = customers.reduce((n, c) => n + c.purchases, 0);
  const intent = await highIntentView();
  const engaged = intent.length;

  return {
    rows, routing, inventory,
    metrics: {
      readyToSell: inventory.readyToSell,
      addressableRevenueCents: inventory.addressableRevenueCents,
      inFulfillment,
      customers: customers.length,
      revenueCents,
      purchases,
      engaged,
      coldOutreachFrozen: inventory.coldOutreachFrozen,
    },
  };
}

// ── High purchase intent — from MEASURABLE funnel events only (audit log) ────────
const FUNNEL_ACTION_RE = /^quickfix\.(email_opened|pdf_viewed|diagnostic_video_viewed|offer_page_viewed|trust_video_started|trust_video_completed|checkout_clicked|terms_accepted|checkout_started|purchase_completed)$/;

export interface HighIntentRow {
  offerId: string;
  company: string;
  sku: string | null;
  priceCents: number | null;
  intentScore: number;
  strongestSignal: string | null;
  events: string[];
  lastActionAt: string | null;
  checkoutState: string;
  recommendedNextStep: string;
}

export async function highIntentView(): Promise<HighIntentRow[]> {
  const audit = await listAudit(4000);
  const byOffer = new Map<string, { events: string[]; last: string | null }>();
  for (const a of audit) {
    if (a.targetType !== "quickfix_offer" || !a.targetId) continue;
    if (!FUNNEL_ACTION_RE.test(a.action)) continue;
    const rec = byOffer.get(a.targetId) ?? { events: [], last: null };
    rec.events.push(a.action);
    if (!rec.last || a.createdAt > rec.last) rec.last = a.createdAt;
    byOffer.set(a.targetId, rec);
  }
  const rows: HighIntentRow[] = [];
  for (const [offerId, rec] of byOffer) {
    const purchased = rec.events.includes("quickfix.purchase_completed");
    const startedCheckout = rec.events.includes("quickfix.checkout_started");
    const intent = scoreIntent({ events: rec.events, checkoutAbandoned: startedCheckout && !purchased });
    if (intent.score <= 0) continue;
    const offer = await store.getOffer(offerId);
    rows.push({
      offerId,
      company: offer?.companyName ?? offerId,
      sku: offer?.capabilityKeys[0] ?? null,
      priceCents: offer?.priceCents ?? null,
      intentScore: intent.score,
      strongestSignal: intent.strongestSignal,
      events: rec.events,
      lastActionAt: rec.last,
      checkoutState: purchased ? "PURCHASED" : startedCheckout ? "CHECKOUT_STARTED" : "ENGAGED",
      recommendedNextStep: intent.recommendedNextStep,
    });
  }
  return rows.sort((a, b) => b.intentScore - a.intentScore);
}

// ── Ready-for-fulfillment (paid-work inbox) ──────────────────────────────────────
export interface FulfillmentRow {
  offerId: string;
  company: string;
  sku: string | null;
  priceCents: number | null;
  state: string;
  purchasedAt: string | null;
  requirementsReceivedAt: string | null;
  targetDeliveryAt: string | null;
  blocking: number;
  qaItems: number;
}

export async function fulfillmentView(): Promise<{ rows: FulfillmentRow[]; byState: Record<string, number> }> {
  const jobs = await store.listJobs();
  const rows: FulfillmentRow[] = [];
  const byState: Record<string, number> = {};
  for (const j of jobs) {
    byState[j.state] = (byState[j.state] ?? 0) + 1;
    const offer = await store.getOffer(j.offerId);
    const skuKey = offer?.capabilityKeys[0] ?? null;
    const pb = skuKey ? playbookFor(skuKey) : null;
    rows.push({
      offerId: j.offerId,
      company: offer?.companyName ?? j.leadId,
      sku: skuKey,
      priceCents: offer?.priceCents ?? null,
      state: j.state,
      purchasedAt: j.purchasedAt,
      requirementsReceivedAt: j.requirementsReceivedAt,
      targetDeliveryAt: j.targetDeliveryAt,
      blocking: offer ? (await import("./requirements")).buildRequirements(offer).blockingCount : 0,
      qaItems: pb?.qaChecklist.length ?? 0,
    });
  }
  // Ready first, then in-progress, waiting, delivered.
  const order = ["READY_FOR_FULFILLMENT", "IN_PROGRESS", "QA", "WAITING_FOR_CUSTOMER_INPUT", "PAID", "DELIVERED", "COMPLETE", "REFUNDED", "CANCELED"];
  rows.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return { rows, byState };
}

// ── Catalog (operator visibility; versioned; no unsafe mutation) ─────────────────
export interface CatalogRow {
  key: string;
  name: string;
  family: string;
  priceHint: string;
  priceVersion: string;
  slaLabel: string;
  state: string;
  platformCompatibility: string[];
  estLaborMinutes: number | null;
  automation: string;
  active: boolean;
  requiredAccess: string[];
  included: string[];
  excluded: string[];
}

export function catalogView(): { rows: CatalogRow[]; priceVersions: ReturnType<typeof baselinePriceVersions>; automationDefault: string; autoAllowlist: string[] } {
  const rows: CatalogRow[] = listSkus().map((s) => {
    const cap = capabilityByKey(s.key);
    const pb = playbookFor(s.key);
    return {
      key: s.key,
      name: s.name,
      family: s.family,
      priceHint: `$${s.priceHintHours[0]}–${s.priceHintHours[1]}h band`,
      priceVersion: s.version,
      slaLabel: s.slaLabel,
      state: s.state,
      platformCompatibility: s.platformCompatibility,
      estLaborMinutes: pb?.estimatedLaborMinutes ?? null,
      automation: DEFAULT_AUTOMATION_LEVEL,
      active: true,
      requiredAccess: cap?.accessRequirements.map((a) => a.label) ?? [],
      included: cap?.includedItems ?? [],
      excluded: cap?.excludedItems ?? [],
    };
  });
  // The $99 Fix Scan diagnostic SKU (routing + credit rules apply).
  rows.unshift({
    key: FIX_SCAN_SKU.key,
    name: FIX_SCAN_SKU.name,
    family: FIX_SCAN_SKU.family,
    priceHint: "$99 flat",
    priceVersion: FIX_SCAN_SKU.version,
    slaLabel: FIX_SCAN_SKU.slaLabel,
    state: "APPROVED",
    platformCompatibility: ["WordPress", "Shopify", "Webflow", "Squarespace", "Wix", "custom"],
    estLaborMinutes: FIX_SCAN_SKU.estimatedLaborMinutes,
    automation: DEFAULT_AUTOMATION_LEVEL,
    active: true,
    requiredAccess: [...FIX_SCAN_SKU.scope.requiredAccess],
    included: [...FIX_SCAN_SKU.scope.includes],
    excluded: [...FIX_SCAN_SKU.scope.excludes],
  });
  return { rows, priceVersions: baselinePriceVersions(""), automationDefault: DEFAULT_AUTOMATION_LEVEL, autoAllowlist: [...AUTO_ELIGIBLE_CAPABILITY_ALLOWLIST] };
}

// ── Profitability (actuals=null until live sales — honest) ───────────────────────
export interface ProfitRow {
  skuKey: string;
  sales: number;
  revenueCents: number;
  actualHours: number | null;
  estimatedHours: number | null;
  effectiveHourlyCents: number | null;
  verdict: string;
}

export async function profitabilityView(): Promise<{ rows: ProfitRow[]; northStar: ReturnType<typeof northStar> }> {
  const jobs = await store.listJobs();
  // Group paid jobs by SKU. Operator time is NOT tracked yet → actualHours null.
  const bySku = new Map<string, { sales: number; revenueCents: number }>();
  const econ: JobEconomicsActuals[] = [];
  for (const j of jobs) {
    const offer = await store.getOffer(j.offerId);
    const skuKey = offer?.capabilityKeys[0] ?? "artifex-fix-scan";
    const price = offer?.priceCents ?? FIX_SCAN_SKU.priceCents;
    const g = bySku.get(skuKey) ?? { sales: 0, revenueCents: 0 };
    g.sales += 1; g.revenueCents += price;
    bySku.set(skuKey, g);
    econ.push({ priceCents: price, externalCostCents: 0, refundCents: 0, operatorMinutes: null });
  }
  const rows: ProfitRow[] = listSkus().map((s) => {
    const g = bySku.get(s.key) ?? { sales: 0, revenueCents: 0 };
    const estHours = (s.priceHintHours[0] + s.priceHintHours[1]) / 2;
    const verdict = classifySku({ skuKey: s.key, sales: g.sales, revenueCents: g.revenueCents, estimatedHours: estHours, actualHours: null, externalCostCents: 0, refundsCents: 0, grossContributionCents: g.revenueCents, effectiveHourlyCents: null, conversionRate: null, repeatPurchaseRate: null, maintenanceAttachRate: null });
    return { skuKey: s.key, sales: g.sales, revenueCents: g.revenueCents, actualHours: null, estimatedHours: estHours, effectiveHourlyCents: null, verdict };
  });
  return { rows, northStar: northStar(econ) };
}

// ── Customers / CLV ──────────────────────────────────────────────────────────────
export interface CustomerView {
  leadId: string;
  company: string;
  firstPurchaseType: string;
  firstPurchaseAt: string;
  lifetimeRevenueCents: number;
  purchases: number;
  maintenancePlanKey: string | null;
  lastDeliveredAt: string | null;
  nextOpportunity: string | null;
}

export async function customersView(): Promise<CustomerView[]> {
  const state = await store.getState();
  const rows: CustomerView[] = [];
  for (const c of Object.values(state.customers)) {
    const anyOffer = c.offersPurchased[0] ? await store.getOffer(c.offersPurchased[0]) : null;
    rows.push({
      leadId: c.leadId,
      company: anyOffer?.companyName ?? c.leadId,
      firstPurchaseType: c.firstPurchaseType,
      firstPurchaseAt: c.firstPurchaseAt,
      lifetimeRevenueCents: c.lifetimeRevenueCents,
      purchases: c.offersPurchased.length,
      maintenancePlanKey: c.maintenancePlanKey,
      lastDeliveredAt: c.lastDeliveredAt,
      nextOpportunity: c.nextOpportunity,
    });
  }
  return rows.sort((a, b) => b.lifetimeRevenueCents - a.lifetimeRevenueCents);
}

// ── Hub summary ──────────────────────────────────────────────────────────────────
export async function revenueSummary(): Promise<{ jobsByState: Record<string, number>; customers: number; northStar: ReturnType<typeof northStar>; automationDefault: string; autoAllowlistEmpty: boolean; stripeConfigured: boolean }> {
  const fulfil = await fulfillmentView();
  const customers = (await customersView()).length;
  const prof = await profitabilityView();
  return {
    jobsByState: fulfil.byState,
    customers,
    northStar: prof.northStar,
    automationDefault: DEFAULT_AUTOMATION_LEVEL,
    autoAllowlistEmpty: AUTO_ELIGIBLE_CAPABILITY_ALLOWLIST.length === 0,
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
  };
}

// re-export for the catalog page
export { skuFor, jobProfit };

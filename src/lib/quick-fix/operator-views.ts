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
import {
  deriveQuickCashLifecycle, prospectDeliveryEnabled, QUICK_CASH_STATE_ORDER,
  type QuickCashState, type QuickCashLifecycle,
} from "./quick-cash-lifecycle";
import { buildEvidencePackage, customerReceivesManifest, type EvidencePackage, type ManifestRow, type EvidenceAssetRef, type AssetStatus } from "./evidence-package";
import { composeOfferOutreach, type OfferOutreachCopy } from "./offer-outreach";
import { offerIdFor } from "./store";
import { ARTIFEX_IDENTITY } from "../identity";
import { experienceFrameForOffer, type ExperienceFrame } from "./experience-frame";
import { buildOutreachAttachments } from "./email-attachment-policy";
import { assembleDiagnosticDoc } from "./diagnostic-pdf";
import { assessOfferReadiness, PERSUASION_POLICY_VERSION, type ReadinessResult, type OfferArtifact } from "./offer-readiness";
import { evidenceVersion, type DependentAsset } from "./evidence-truth";
import {
  runBreakbotPreflight,
  type BreakbotVerdict,
  type BreakbotPreflightInput,
} from "../breakbot/quickcash-preflight";
import { trustVideoForOffer } from "./trust-videos";
import { resolveJourneyTrustVideo } from "./trust-video-resolve";
import { personalizedVideoServedPaths } from "./personalized-video";
import { qualifyLeadRecord } from "./qualification-adapter";

// ── Build fresh lead contexts (lead + offer + BI) from current inventory ──────────
// One pass over the inventory so qualification, routing, and ranking can all read
// the same {lead, offer, bi} without re-fetching. Only leads with a BI profile get
// an offer; the rest are still returned (offer null) so nothing is silently dropped.
export interface LeadContext { lead: any; offer: QuickFixOffer | null; bi: any }

export async function buildLeadContexts(limit = 500): Promise<LeadContext[]> {
  const leads = await listLeads();
  const out: LeadContext[] = [];
  for (const lead of leads.slice(0, limit)) {
    const bi = await getBusinessIntelligence(lead.id).catch(() => null);
    const profile = (bi?.profile as any)?.businessProfile ?? null;
    if (!profile) { out.push({ lead, offer: null, bi }); continue; }
    const opps = Array.isArray(profile.opportunities) ? profile.opportunities : [];
    const offer = buildOfferForLead({ leadId: lead.id, companyName: (lead as any).businessName ?? lead.id, opportunities: opps, website: (lead as any).website, generatedAt: null });
    out.push({ lead, offer, bi });
  }
  return out;
}

// ── Build fresh offers from the current lead inventory (same path as the dry-run) ─
export async function buildLeadOffers(limit = 500): Promise<QuickFixOffer[]> {
  return (await buildLeadContexts(limit)).map((c) => c.offer).filter((o): o is QuickFixOffer => !!o);
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
  /** Honest usable-inventory funnel — raw discovery count is NOT sellable inventory. */
  funnel: {
    totalDiscovered: number;
    hasWebsite: number;
    emailable: number; // auto-sendable address
    emailableWithApproval: number;
    commerciallyQualified: number;
    evidenceQualified: number;
    readyToSell: number; // passed the FULL strict funnel
    highConfidenceSendable: number; // ready-to-sell with an auto-sendable address
  };
  /** Preserved-but-not-sold buckets (never deleted, never counted as sendable). */
  disqualified: {
    noEmail: number;
    noWebsite: number;
    suppressed: number;
    competitiveOverlap: number;
    inactive: number;
    weakEvidence: number;
    weakCommercialFit: number;
    jurisdictionBlocked: number;
    jurisdictionUnknown: number;
  };
  /** Gated ready-to-sell (full funnel) — NOT the old fixability-only count. */
  readyToSell: number;
  /** Gated sendable revenue — excludes no-email / no-website / suppressed / disqualified. */
  addressableRevenueCents: number;
  coldOutreachFrozen: boolean;
  /** Every non-customer lead is counted under exactly one route (invariant check). */
  exactlyOneRoutePerLead: boolean;
}

export async function quickCashInventory(opts: { limit?: number; contexts?: LeadContext[] } = {}): Promise<QuickCashInventory> {
  const { legacyColdOutreachFrozen } = await import("../outreach/legacy-freeze");
  const { qualifyLeadRecord } = await import("./qualification-adapter");
  const state = await store.getState();
  const customerLeadIds = new Set(Object.keys(state.customers));

  const contexts = opts.contexts ?? (await buildLeadContexts(opts.limit ?? 1000));
  const nonCustomer = contexts.filter((c) => !customerLeadIds.has(c.lead.id));

  // Route classification (preserved): every non-customer lead resolves to exactly one route.
  const routes = { DIRECT_FIX: 0, FIX_SCAN: 0, CONVERSATION_REQUIRED: 0, NO_FIX_FOUND: 0 };
  for (const c of nonCustomer) {
    if (c.offer) routes[routeLead(c.offer).route] += 1;
    else routes.NO_FIX_FOUND += 1; // no BI profile / no fix
  }

  // Suppression checker (by lead domain).
  const check = await buildSuppressionChecker();
  const isSuppressed = (site: string | undefined): boolean => {
    let domain: string | null = null;
    if (site) { try { domain = new URL(site.startsWith("http") ? site : `https://${site}`).hostname.replace(/^www\./, ""); } catch { domain = null; } }
    return !!domain && check({ domain });
  };

  const funnel = { totalDiscovered: nonCustomer.length, hasWebsite: 0, emailable: 0, emailableWithApproval: 0, commerciallyQualified: 0, evidenceQualified: 0, readyToSell: 0, highConfidenceSendable: 0 };
  const disqualified = { noEmail: 0, noWebsite: 0, suppressed: 0, competitiveOverlap: 0, inactive: 0, weakEvidence: 0, weakCommercialFit: 0, jurisdictionBlocked: 0, jurisdictionUnknown: 0 };
  let addressableRevenueCents = 0;
  let suppressed = 0;

  for (const c of nonCustomer) {
    const supp = isSuppressed(c.lead.website);
    if (supp) suppressed += 1;
    const q = qualifyLeadRecord({ lead: c.lead, offer: c.offer, bi: c.bi, suppressed: supp });
    if (c.lead.website) funnel.hasWebsite += 1;
    if (q.contactability.emailableAuto) funnel.emailable += 1;
    if (q.contactability.emailableWithApproval) funnel.emailableWithApproval += 1;
    if (q.commercialFit.makesCommercialSense) funnel.commerciallyQualified += 1;
    if (c.offer && (c.offer.evidenceGrade === "OBSERVED" || c.offer.confidence >= 0.6)) funnel.evidenceQualified += 1;
    if (q.qualification.readyToSell) { funnel.readyToSell += 1; funnel.highConfidenceSendable += 1; addressableRevenueCents += q.sendablePriceCents; }
    const dq = new Set(q.qualification.disqualifiers);
    if (dq.has("NO_EMAIL")) disqualified.noEmail += 1;
    if (dq.has("NO_WEBSITE")) disqualified.noWebsite += 1;
    if (dq.has("SUPPRESSED")) disqualified.suppressed += 1;
    if (dq.has("COMPETITIVE_OVERLAP")) disqualified.competitiveOverlap += 1;
    if (dq.has("INACTIVE_BUSINESS")) disqualified.inactive += 1;
    if (dq.has("WEAK_EVIDENCE")) disqualified.weakEvidence += 1;
    if (dq.has("WEAK_COMMERCIAL_FIT")) disqualified.weakCommercialFit += 1;
    if (dq.has("JURISDICTION_BLOCKED")) disqualified.jurisdictionBlocked += 1;
    if (dq.has("JURISDICTION_UNKNOWN")) disqualified.jurisdictionUnknown += 1;
  }

  const { listScheduledBindings } = await import("../outreach/scheduled-batch");
  const legacyFrozenScheduled = (await listScheduledBindings()).length;

  const routedTotal = routes.DIRECT_FIX + routes.FIX_SCAN + routes.CONVERSATION_REQUIRED + routes.NO_FIX_FOUND;
  return {
    totalLeads: contexts.length,
    customers: customerLeadIds.size,
    suppressed,
    legacyFrozenScheduled,
    routes,
    funnel,
    disqualified,
    readyToSell: funnel.readyToSell,
    addressableRevenueCents,
    coldOutreachFrozen: legacyColdOutreachFrozen(),
    exactlyOneRoutePerLead: routedTotal === nonCustomer.length,
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
  const contexts = await buildLeadContexts(limit);
  const offers = contexts.map((c) => c.offer).filter((o): o is QuickFixOffer => !!o);
  const rows = rankQuickCash(offers);
  const routing = { DIRECT_FIX: 0, FIX_SCAN: 0, CONVERSATION_REQUIRED: 0, NO_FIX_FOUND: 0, cannibalization: 0 };
  for (const o of offers) { const r = routeLead(o); routing[r.route] += 1; if (r.cannibalizationFlag) routing.cannibalization += 1; }

  const inventory = await quickCashInventory({ contexts });
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

// DEMO jobs are HARD-excluded from every real fulfillment/revenue/customer/sprint
// number. A demonstration job must never appear in the money loop.
function isRealJob(j: import("./store").JobRecord): boolean { return j.isDemo !== true; }

export async function fulfillmentView(): Promise<{ rows: FulfillmentRow[]; byState: Record<string, number> }> {
  const jobs = (await store.listJobs()).filter(isRealJob);
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

// ── Fulfillment Packet view — the technician workspace's canonical data ──────────
function extractPlatform(bi: any): string | null {
  const p = bi?.profile?.businessProfile ?? bi?.businessProfile ?? null;
  const techs = p?.technologies ?? p?.detectedTech ?? bi?.technologies ?? null;
  if (Array.isArray(techs)) {
    for (const t of techs) {
      const name = typeof t === "string" ? t : (t?.name ?? "");
      if (/wordpress|woocommerce|shopify|squarespace|webflow|wix|godaddy/i.test(name)) return name;
    }
  }
  // Fall back to a scoped scan of the profile text for a CMS signature.
  const blob = JSON.stringify(p ?? "").toLowerCase();
  for (const k of ["wordpress", "shopify", "squarespace", "webflow", "wix", "godaddy"]) if (blob.includes(k)) return k;
  return null;
}

export async function fulfillmentPacketView(offerId: string): Promise<import("./fulfillment-center").FulfillmentPacket | null> {
  const { buildFulfillmentPacket } = await import("./fulfillment-center");
  const offer = await store.getOffer(offerId);
  if (!offer) return null;
  const job = await store.getJob(offerId);
  if (!job) return null;
  const state = await store.getState();
  const customer = state.customers[offer.leadId] ?? null;
  const bi = await getBusinessIntelligence(offer.leadId).catch(() => null);
  const acc = await store.getTermsAcceptance(offerId).catch(() => null);
  return buildFulfillmentPacket({
    offer: offer as unknown as QuickFixOffer,
    job,
    customer,
    detectedPlatform: extractPlatform(bi),
    termsVersion: acc?.termsVersion ?? null,
  });
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
  const jobs = (await store.listJobs()).filter(isRealJob);
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
  // A customer whose ONLY jobs are demo jobs is a demo-only customer — excluded from
  // real revenue/customer numbers. Customers with a real job (or no job record) stay.
  const allJobs = await store.listJobs();
  const demoOnlyLeadIds = new Set<string>();
  const jobsByLead = new Map<string, import("./store").JobRecord[]>();
  for (const j of allJobs) { const arr = jobsByLead.get(j.leadId) ?? []; arr.push(j); jobsByLead.set(j.leadId, arr); }
  for (const [leadId, js] of jobsByLead) {
    if (js.length > 0 && js.every((j) => j.isDemo === true)) demoOnlyLeadIds.add(leadId);
  }
  const rows: CustomerView[] = [];
  for (const c of Object.values(state.customers)) {
    if (demoOnlyLeadIds.has(c.leadId)) continue; // never count a demo-only customer
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

// ── Evidence package + "customer receives" (Part H) — read-only accessors ────────
// The operator evidence surface and the customer-facing "what you receive" manifest
// both read from the ONE evidence truth. Read-only: no sends, no charges, no writes.

/** Load the offer and build its canonical evidence package. Null when offer missing. */
export async function evidencePackageView(offerId: string): Promise<EvidencePackage | null> {
  const offer = await store.getOffer(offerId);
  if (!offer) return null;
  // Pass the persisted personalized-video record so evidence.personalizedVideo resolves
  // its true READY/STALE/MISSING status (never silently MISSING when a record exists).
  return buildEvidencePackage(offer as unknown as QuickFixOffer, { personalizedVideo: offer.personalizedVideo ?? null });
}

/** The customer-receives manifest for an offer. `emailReady` is derived from whether
 *  a fabrication-safe outreach draft actually composes (composeOfferOutreach().safe).
 *  Null when the offer is missing. Read-only. */
export async function customerReceivesView(offerId: string): Promise<ManifestRow[] | null> {
  const offer = await store.getOffer(offerId);
  if (!offer) return null;
  const pkg = await buildEvidencePackage(offer as unknown as QuickFixOffer, { personalizedVideo: offer.personalizedVideo ?? null });
  // A fabrication-safe draft must compose for the offer email to be "receivable".
  const draft = composeOfferOutreach(offer as unknown as QuickFixOffer, { buyUrl: `/offer/${offerId}`, bookingUrl: "" });
  return customerReceivesManifest(pkg, offer as unknown as QuickFixOffer, draft.safe);
}

// re-export for the catalog page
export { skuFor, jobProfit };

// ── Fulfillment workspace state (Part A) — packet + PERSISTED sub-state ───────────
// The packet is stateless; this pairs it with the durable job sub-state (runbook /
// access / QA / evidence) so the technician workspace resumes exactly on reload and
// the server-side delivery gate can be reflected. NEVER returns a secret.
export async function fulfillmentWorkspaceView(offerId: string): Promise<{
  packet: import("./fulfillment-center").FulfillmentPacket;
  platform: string;
  runbookState: import("./store").RunbookState | null;
  accessState: Record<string, import("./store").AccessItemState>;
  qaState: Record<string, import("./store").QaItemState>;
  evidence: import("./store").EvidenceItem[];
  gate: import("./fulfillment-gates").DeliveryGate;
} | null> {
  const { buildFulfillmentPacket, normalizePlatform } = await import("./fulfillment-center");
  const { deliveryGate } = await import("./fulfillment-gates");
  const offer = await store.getOffer(offerId);
  if (!offer) return null;
  const job = await store.getJob(offerId);
  if (!job) return null;
  const state = await store.getState();
  const customer = state.customers[offer.leadId] ?? null;
  const bi = await getBusinessIntelligence(offer.leadId).catch(() => null);
  const acc = await store.getTermsAcceptance(offerId).catch(() => null);
  const detectedPlatform = extractPlatform(bi);
  const packet = buildFulfillmentPacket({
    offer: offer as unknown as QuickFixOffer,
    job,
    customer,
    detectedPlatform,
    termsVersion: acc?.termsVersion ?? null,
  });
  const platform = normalizePlatform(detectedPlatform);
  const gate = deliveryGate(offer as unknown as QuickFixOffer, job, platform);
  return {
    packet,
    platform,
    runbookState: job.runbookState ?? null,
    accessState: job.accessState ?? {},
    qaState: job.qaState ?? {},
    evidence: job.evidence ?? [],
    gate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OPPORTUNITY WORKSPACE (Parts A/B/C/H/J/K/O) — the mobile-first operator command
// center for ONE opportunity. Assembles everything the operator needs to answer,
// on one iPhone screen: WHO · Open Website ↗ · STATUS · what we found · what we're
// selling + price · evidence presence · the PRIMARY NEXT ACTION — plus the tab data
// (Evidence / Video / PDF / Email / Offer / Activity). Read-only. NEVER sends, never
// charges, never schedules — it only reads state + the fixed contracts.
// ─────────────────────────────────────────────────────────────────────────────

/** The FIXED outreach-lifecycle contract, mirrored here so the workspace type-checks
 *  before/independently of the sibling agent's outreach-lifecycle-view.ts landing.
 *  Do NOT diverge from the contract in the mandate — this is the same shape. */
export type OutreachState = "NEEDS_REVIEW" | "APPROVED_NOT_SENT" | "SCHEDULED" | "SENT" | "PURCHASED";
export interface OutreachLifecycle {
  offerId: string;
  outreachState: OutreachState;
  subject: { selected: string | null; alternatives: string[]; family: string | null; frozen: boolean };
  scheduledAt: string | null;
  scheduledTz: string | null;
  sentAt: string | null;
  sentMailbox: string | null;
  sentRecipient: string | null;
  canApprove: boolean;
  canSend: boolean;
  canSchedule: boolean;
}

/** Load the outreach lifecycle for an offer from the sibling agent's view when it
 *  exists; otherwise fall back to an honest lifecycle derived from stored approval
 *  state so the operator surface never crashes or fabricates a "sent". Read-only. */
async function loadOutreachLifecycle(offerId: string, offer: import("./store").StoredOffer, draftSubject: string): Promise<OutreachLifecycle> {
  try {
    const mod: any = await import("./outreach-lifecycle-view" as any).catch(() => null);
    if (mod && typeof mod.outreachLifecycleView === "function") {
      const lc = await mod.outreachLifecycleView(offerId);
      if (lc) return lc as OutreachLifecycle;
    }
  } catch { /* fall through to the honest local derivation */ }
  // Honest fallback: never claims SENT/SCHEDULED — we only know approval state here.
  const job = await store.getJob(offerId).catch(() => null);
  const purchased = !!job && ["PAID", "WAITING_FOR_CUSTOMER_INPUT", "READY_FOR_FULFILLMENT", "IN_PROGRESS", "QA", "DELIVERED", "COMPLETE"].includes(job.state);
  const approved = offer.approvalStatus === "approved";
  const state: OutreachState = purchased ? "PURCHASED" : approved ? "APPROVED_NOT_SENT" : "NEEDS_REVIEW";
  return {
    offerId,
    outreachState: state,
    subject: { selected: draftSubject, alternatives: [], family: null, frozen: approved },
    scheduledAt: null, scheduledTz: null, sentAt: null, sentMailbox: null, sentRecipient: null,
    canApprove: state === "NEEDS_REVIEW",
    canSend: state === "APPROVED_NOT_SENT",
    canSchedule: state === "APPROVED_NOT_SENT",
  };
}

/** From / To / Subject header the operator sees for the composed email (Part C). */
export interface EmailHeader { fromName: string; fromEmail: string; to: string | null; subject: string }

/** A friendly-labelled link extracted from the composed email body (Part C). The raw
 *  href stays correct; the label is what the operator/customer reads. */
export interface EmailLink { label: string; href: string; kind: "buy" | "book" | "other" }

export interface OpportunityWorkspace {
  offerId: string;
  leadId: string;
  company: string;
  /** Canonical STORED website URL — the operator taps this, never hunts for it. */
  websiteUrl: string | null;
  priceCents: number | null;
  band: string | null;
  quickFixEligible: boolean;
  offerName: string;
  /** WHAT WE FOUND — the evidence-graded problem statement (plain, non-fabricated). */
  whatWeFound: string;
  /** WHAT WE'RE SELLING — customer-facing solution line. */
  whatWeSell: string;
  confidence: number;
  evidenceGrade: string;
  /** The canonical status the UI renders as ONE unmistakable badge. */
  lifecycle: OutreachLifecycle;
  /** Evidence presence roll-up for the first screen (screenshots/video/PDF). */
  evidence: EvidencePackage;
  /** CUSTOMER RECEIVES manifest — real bindings only (Part H). */
  customerReceives: ManifestRow[];
  /** The composed email, rendered as an email (Part C). */
  email: {
    header: EmailHeader;
    bodyHtml: string;
    bodyText: string;
    primaryCta: OfferOutreachCopy["primaryCta"];
    safe: boolean;
    /** Friendly-labelled links; raw hrefs preserved for the technical panel. */
    links: EmailLink[];
    /** EMAIL ATTACHMENTS are ALWAYS none — nothing is auto-attached (Part C). */
    attachments: "none";
    /** The customer share/offer path (buy CTA target). */
    offerPath: string;
    bookingUrl: string;
  };
  /** The customer offer-page model for the "Offer" preview tab (Part J). */
  offerPage: import("./offer-page").OfferPageModel;
  /** ONE recommended primary next action, derived from the lifecycle (Part A/O). */
  primaryAction: { label: string; helper: string | null; endpoint: string | null };
}

/** Friendly labels for the two known CTAs; every other raw URL falls to the tech panel. */
function friendlyLinksFromCopy(copy: OfferOutreachCopy, offerPath: string, bookingUrl: string): EmailLink[] {
  const links: EmailLink[] = [];
  if (copy.primaryCta === "PURCHASE") {
    links.push({ label: "See what we found →", href: offerPath, kind: "buy" });
    links.push({ label: "Prefer to talk first? Book a conversation →", href: bookingUrl, kind: "book" });
  } else {
    links.push({ label: "Prefer to talk first? Book a conversation →", href: bookingUrl, kind: "book" });
  }
  return links;
}

/** The one primary action the first screen must surface, from the canonical state. */
function primaryActionFor(lc: OutreachLifecycle): OpportunityWorkspace["primaryAction"] {
  switch (lc.outreachState) {
    case "NEEDS_REVIEW":
      return { label: "APPROVE OFFER", helper: "Approval does not send anything.", endpoint: "/api/revenue/approve" };
    case "APPROVED_NOT_SENT":
      return { label: "SEND EMAIL", helper: "Sending is a separate, deliberate action.", endpoint: "/api/revenue/send" };
    case "SCHEDULED":
      return { label: "Reschedule / Cancel", helper: lc.scheduledAt ? `Scheduled for ${lc.scheduledAt}${lc.scheduledTz ? ` (${lc.scheduledTz})` : ""}.` : null, endpoint: "/api/revenue/schedule" };
    case "SENT":
      return { label: "Awaiting customer", helper: lc.sentAt ? `Sent ${lc.sentAt}${lc.sentRecipient ? ` → ${lc.sentRecipient}` : ""}.` : "Email has been sent.", endpoint: null };
    case "PURCHASED":
      return { label: "OPEN FULFILLMENT", helper: "This opportunity converted — deliver the paid work.", endpoint: null };
  }
}

/**
 * Assemble the full opportunity workspace for an offerId. Prefers a STORED offer;
 * if none is stored yet it rebuilds the offer from the lead's BI (same path as the
 * dry-run) so a not-yet-prepared opportunity can still be inspected. Returns null
 * only when neither a stored offer nor a rebuildable lead offer exists.
 */
export async function opportunityWorkspaceView(offerId: string): Promise<OpportunityWorkspace | null> {
  const stored = await store.getOffer(offerId);
  if (!stored) return null;
  const offer = stored as unknown as QuickFixOffer;

  // ONE evidence truth → package + customer-receives manifest. Pass the persisted
  // personalized-video record so its readiness is TRUE across the evidence view and the
  // customer-receives manifest (never silently MISSING when a record exists).
  const evidence = await buildEvidencePackage(offer, { personalizedVideo: stored.personalizedVideo ?? null });
  const offerPath = `/offer/${stored.shareToken}`;
  const bookingUrl = ARTIFEX_IDENTITY.bookingUrl;
  const copy = composeOfferOutreach(offer, { buyUrl: offerPath, bookingUrl });
  const customerReceives = customerReceivesManifest(evidence, offer, copy.safe);

  // Canonical status (fixed contract; honest fallback until sibling view lands).
  const lifecycle = await loadOutreachLifecycle(offerId, stored, copy.subject);

  // Offer-page model for the "Offer" tab (same source the customer page renders).
  const view = await (await import("./page-service")).buildPublicOfferView(offerId, { preview: true });
  const offerPage = view!.model;

  return {
    offerId,
    leadId: stored.leadId,
    company: stored.companyName,
    websiteUrl: evidence.websiteUrl,
    priceCents: offer.quickFixEligible ? offer.priceCents : null,
    band: offer.quickFixEligible ? offer.band : null,
    quickFixEligible: offer.quickFixEligible,
    offerName: offer.scope.offerName,
    whatWeFound: offer.scope.problemBeingSolved || offer.notEligibleReason || "",
    whatWeSell: offer.scope.proposedSolution || offer.scope.offerName,
    confidence: offer.confidence,
    evidenceGrade: offer.evidenceGrade,
    lifecycle,
    evidence,
    customerReceives,
    email: {
      header: { fromName: ARTIFEX_IDENTITY.mailSenderName, fromEmail: ARTIFEX_IDENTITY.publicEmail, to: stored.recipientEmail, subject: lifecycle.subject.selected ?? copy.subject },
      bodyHtml: copy.bodyHtml,
      bodyText: copy.bodyText,
      primaryCta: copy.primaryCta,
      safe: copy.safe,
      links: friendlyLinksFromCopy(copy, offerPath, bookingUrl),
      attachments: "none",
      offerPath,
      bookingUrl,
    },
    offerPage,
    primaryAction: primaryActionFor(lifecycle),
  };
}

// ── Quick-Cash opportunities list (Part A entry point) — ranked rows enriched with
// the STORED offerId when the offer is prepared, so the operator taps straight into
// the opportunity workspace instead of a raw lead hunt. Read-only.
export interface QuickCashOpportunityRow extends QuickCashRow {
  /** The STORED offerId when this lead's offer is already prepared, else null. */
  offerId: string | null;
  websiteUrl: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK CASH — AUTONOMOUS OPERATING QUEUE (mandate E). The page shows canonical
// lifecycle state (from persisted truth), not an approval inbox. Eligible packages
// are auto-reconciled (persisted + approved) with NO per-lead operator click, so a
// completed package never reverts to "needs approval" on refresh.
// ─────────────────────────────────────────────────────────────────────────────
export interface QuickCashPipelineRow {
  leadId: string;
  company: string;
  offerName: string;
  problem: string;
  priceCents: number;
  band: string | null;
  sla: string | null;
  offerId: string | null;
  shareToken: string | null;
  lifecycle: QuickCashLifecycle;
  // Identity + market + reality (Problem-Reality amendment §13/§41).
  market: string;
  inMarket: boolean;
  googleUrl: string | null;
  websiteUrl: string | null;
  problemReality: string | null;
  // Secondary detail (shown only in expanded/detail views on mobile).
  score: number;
  estimatedHours: number;
  effectiveHourlyCents: number;
  confidence: number;
}

export interface QuickCashOutbound {
  deliveryOn: boolean;
  posture: "PAUSED" | "WARMING" | "ACTIVE";
  lanes: Array<{ laneId: string; state: string }>;
}

export interface QuickCashPipelineView {
  rows: QuickCashPipelineRow[];
  counts: Record<QuickCashState, number>;
  order: QuickCashState[];
  totals: ReturnType<typeof addressableTotals>;
  outbound: QuickCashOutbound;
}

/**
 * The autonomous Quick Cash pipeline. Reconciles eligible packages into their correct
 * canonical state (idempotent — steady state performs NO writes), then derives each
 * card's lifecycle from persisted truth + the delivery posture. Read-mostly; never
 * sends or charges. While delivery is OFF, complete packages are READY · Waiting for
 * outbound activation — never a fake SCHEDULED.
 */
export async function quickCashPipelineView(limit = 500): Promise<QuickCashPipelineView> {
  const contexts = await buildLeadContexts(limit);
  const offers = contexts.map((c) => c.offer).filter((o): o is QuickFixOffer => !!o);
  const ranked = rankQuickCash(offers);
  const totals = addressableTotals(offers);
  const now = new Date().toISOString();

  // Auto-reconcile: persist + approve any eligible offer not already approved. Only writes
  // when something is actually missing (so a warm page load performs zero writes).
  let state = await store.getState();
  const eligibleOffers = offers.filter((o) => o.quickFixEligible);
  const needing = eligibleOffers.filter((o) => {
    const stored = state.offers[store.offerIdFor(o)];
    return !stored || stored.approvalStatus !== "approved";
  });
  if (needing.length) {
    await store.reconcileQuickCashOffers(needing, { now });
    state = await store.getState();
  }

  const storedByLead = new Map<string, store.StoredOffer>();
  for (const o of Object.values(state.offers)) {
    const prev = storedByLead.get(o.leadId);
    if (!prev || (o.updatedAt ?? "") > (prev.updatedAt ?? "")) storedByLead.set(o.leadId, o);
  }
  const jobs = await store.listJobs();
  const purchasedOfferIds = new Set(jobs.map((j) => j.offerId));
  const deliveryOn = prospectDeliveryEnabled();

  // Lead identity (market + Google profile) keyed by leadId for the card (§13/§41).
  const { assessMarketGate, marketLabel, googleProfileUrl } = await import("./market-gate");
  const leadById = new Map(contexts.map((c) => [c.lead.id, c.lead]));

  const rows: QuickCashPipelineRow[] = ranked.map((r) => {
    const stored = storedByLead.get(r.leadId) ?? null;
    const lead = leadById.get(r.leadId) as { city?: string; state?: string; googlePlaceId?: string | null; businessName?: string; website?: string | null } | undefined;
    const loc = { city: lead?.city, state: lead?.state };
    const gate = assessMarketGate(loc);
    const lifecycle = deriveQuickCashLifecycle({
      eligible: r.eligible,
      hasOffer: !!stored,
      approved: stored?.approvalStatus === "approved",
      packageComplete: stored?.approvalStatus === "approved",
      outreachState: stored?.outreachState ?? null,
      purchased: stored ? purchasedOfferIds.has(stored.offerId) : false,
      deliveryOn,
    });
    return {
      leadId: r.leadId, company: r.company, offerName: r.offerName, problem: r.problem,
      priceCents: r.priceCents, band: r.band, sla: r.sla,
      offerId: stored?.offerId ?? null, shareToken: stored?.shareToken ?? null,
      lifecycle,
      market: marketLabel(loc), inMarket: gate.inMarket,
      googleUrl: lead ? googleProfileUrl({ googlePlaceId: lead.googlePlaceId, businessName: lead.businessName ?? r.company, city: lead.city, state: lead.state }) : null,
      websiteUrl: lead?.website ?? null,
      problemReality: stored?.problemRealityVerdict ?? null,
      score: r.score, estimatedHours: r.estimatedHours, effectiveHourlyCents: r.effectiveHourlyCents, confidence: r.confidence,
    };
  });

  const counts = Object.fromEntries(QUICK_CASH_STATE_ORDER.map((s) => [s, 0])) as Record<QuickCashState, number>;
  for (const row of rows) counts[row.lifecycle.state] += 1;

  // Outbound posture from the real ramp — never claim ACTIVE while delivery is OFF.
  let outbound: QuickCashOutbound = { deliveryOn, posture: deliveryOn ? "ACTIVE" : "PAUSED", lanes: [] };
  try {
    const { rampView } = await import("../comms/ramp-store");
    const rv = await rampView(now);
    const lanes = rv.lanes.map((l) => ({ laneId: l.laneId, state: l.state }));
    const anyWarming = rv.lanes.some((l) => l.state === "WARMING" || l.state === "RAMPING");
    outbound = { deliveryOn, posture: deliveryOn ? "ACTIVE" : anyWarming ? "WARMING" : "PAUSED", lanes };
  } catch { /* ramp view is best-effort */ }

  return { rows, counts, order: QUICK_CASH_STATE_ORDER, totals, outbound };
}

export async function quickCashOpportunitiesView(limit = 500): Promise<{ rows: QuickCashOpportunityRow[]; totals: ReturnType<typeof addressableTotals>; routing: QuickCashView["routing"] }> {
  const contexts = await buildLeadContexts(limit);
  const offers = contexts.map((c) => c.offer).filter((o): o is QuickFixOffer => !!o);
  const ranked = rankQuickCash(offers);
  const totals = addressableTotals(offers);
  const routing = { DIRECT_FIX: 0, FIX_SCAN: 0, CONVERSATION_REQUIRED: 0, NO_FIX_FOUND: 0, cannibalization: 0 };
  for (const o of offers) { const r = routeLead(o); routing[r.route] += 1; if (r.cannibalizationFlag) routing.cannibalization += 1; }

  const state = await store.getState();
  const byLead = new Map<string, string>(); // leadId → stored offerId (prefer the newest)
  for (const o of Object.values(state.offers)) byLead.set(o.leadId, o.offerId);
  const websiteByLead = new Map<string, string | null>();
  for (const c of contexts) websiteByLead.set(c.lead.id, (c.lead as any).website ?? null);

  const rows: QuickCashOpportunityRow[] = ranked.map((r) => ({
    ...r,
    offerId: byLead.get(r.leadId) ?? null,
    websiteUrl: websiteByLead.get(r.leadId) ?? null,
  }));
  return { rows, totals, routing };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY (Part L) — one honest, classified activity feed. The DEFAULT filter is
// Quick-Cash. Legacy scheduled/outreach records are classified "LEGACY — FROZEN"
// and are NEVER shown as active Quick-Cash scheduled sends (the cold path is frozen).
// History is never deleted; every record is preserved and labelled. Read-only.
// ─────────────────────────────────────────────────────────────────────────────
export type ActivityCategory = "QUICK_CASH" | "FULFILLMENT" | "CUSTOMER" | "LEGACY_FROZEN";
export type ActivityFilter = "ALL" | "QUICK_CASH" | "FULFILLMENT" | "CUSTOMER" | "LEGACY_FROZEN";

export interface ActivityItem {
  id: string;
  category: ActivityCategory;
  /** True for a legacy frozen record — the UI must never render it as active. */
  frozen: boolean;
  action: string;
  label: string;          // plain-language summary
  actor: string;
  at: string;             // ISO
  offerId: string | null;
  leadId: string | null;
}

// Action → category classification. Quick-Cash owns the quickfix.* money loop up to
// purchase; fulfillment owns the paid-work + delivery actions; customer owns post-sale
// lifecycle. The legacy cold-outreach actions (outreach.schedule.*, outreach.send.*)
// are ALWAYS legacy-frozen — never active Quick-Cash scheduled.
const FULFILLMENT_ACTIONS = /^quickfix\.(job_|fulfillment|delivered|qa_|access_|runbook|evidence_)/;
const CUSTOMER_ACTIONS = /^quickfix\.(customer_|maintenance_|refund|subscription_)/;
const QUICKCASH_ACTIONS = /^quickfix\./;
const LEGACY_ACTIONS = /^outreach\.(schedule|send|batch)/;

function classifyAudit(a: import("../types").AuditEntry): ActivityCategory {
  if (LEGACY_ACTIONS.test(a.action)) return "LEGACY_FROZEN";
  if (FULFILLMENT_ACTIONS.test(a.action)) return "FULFILLMENT";
  if (CUSTOMER_ACTIONS.test(a.action)) return "CUSTOMER";
  if (QUICKCASH_ACTIONS.test(a.action)) return "QUICK_CASH";
  // Anything else outreach-shaped is legacy; otherwise leave it out of the money loop.
  return "LEGACY_FROZEN";
}

export interface ActivityView {
  filter: ActivityFilter;
  items: ActivityItem[];
  counts: Record<ActivityCategory, number>;
  legacyFrozen: number;
}

export async function activityView(filter: ActivityFilter = "QUICK_CASH", limit = 500): Promise<ActivityView> {
  const audit = await listAudit(4000);
  const items: ActivityItem[] = [];

  for (const a of audit) {
    // Only classify the money-loop + legacy-outreach namespaces; other app audit noise
    // is not part of this operator surface.
    if (!QUICKCASH_ACTIONS.test(a.action) && !LEGACY_ACTIONS.test(a.action)) continue;
    const category = classifyAudit(a);
    const offerId = a.targetType === "quickfix_offer" ? a.targetId : null;
    const leadId = a.targetType === "lead" ? a.targetId : null;
    items.push({
      id: a.id,
      category,
      frozen: category === "LEGACY_FROZEN",
      action: a.action,
      label: a.action.replace(/^quickfix\.|^outreach\./, "").replace(/[._]/g, " "),
      actor: a.actor,
      at: a.createdAt,
      offerId,
      leadId,
    });
  }

  // Legacy scheduled bindings (the frozen cold-outreach schedule) — classified LEGACY
  // FROZEN, NEVER active Quick-Cash scheduled. Preserved, never sent, never deleted.
  try {
    const { listScheduledBindings } = await import("../outreach/scheduled-batch");
    const bindings = await listScheduledBindings();
    for (const { leadId, binding } of bindings) {
      items.push({
        id: `legacy-sched:${leadId}:${binding.scheduledAt}`,
        category: "LEGACY_FROZEN",
        frozen: true,
        action: "outreach.schedule.legacy",
        label: `Legacy scheduled outreach (${binding.status}) — frozen, will not send`,
        actor: binding.by,
        at: binding.scheduledAt,
        offerId: null,
        leadId,
      });
    }
  } catch { /* scheduled store unavailable — omit rather than fabricate */ }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest first

  const counts: Record<ActivityCategory, number> = { QUICK_CASH: 0, FULFILLMENT: 0, CUSTOMER: 0, LEGACY_FROZEN: 0 };
  for (const it of items) counts[it.category] += 1;

  const filtered = filter === "ALL" ? items : items.filter((it) => it.category === filter);
  return { filter, items: filtered.slice(0, limit), counts, legacyFrozen: counts.LEGACY_FROZEN };
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSUASION FLOW PREVIEW (PART T) — the ONE operator-facing view that lays out the
// evidence-first persuasion SEQUENCE for a single opportunity so the operator can
// answer, before approving: "does the prospect understand the PROBLEM before the
// PRICE?" It assembles the four surfaces the prospect will move through —
//   EMAIL  → OFFER PAGE → PDF → VIDEO
// — entirely from the FIXED contracts (experience-frame / offer-outreach / offer-page
// / email-attachment-policy / diagnostic-pdf / evidence-package / offer-readiness).
// It REUSES the existing view builders; it re-implements none of them, and it is
// strictly READ-ONLY: no sends, no charges, no writes.
// ─────────────────────────────────────────────────────────────────────────────

export interface PersuasionEmailFlow {
  subject: string;
  /** The first line the prospect reads — MUST equal experienceFrame.emailOpener. */
  firstLine: string;
  /** True when firstLine is exactly the evidence-backed opener (one evidence truth). */
  firstLineMatchesOpener: boolean;
  /** The disposition of the PDF proof-of-effort on the email: ATTACHED / LINKED / MISSING. */
  pdfAttachment: "ATTACHED" | "LINKED" | "MISSING";
  /** Operator-facing reason the PDF was not attached (null when ATTACHED). */
  pdfReason: string | null;
  /** The link where the video plays, if any (personalized is MISSING → evergreen link). */
  videoLink: string | null;
  /** The customer offer/share path the "See what I found / Watch the review" link targets. */
  offerLink: string;
  /** The email primary CTA. */
  primaryCta: OfferOutreachCopy["primaryCta"];
  /** True when a fabrication-safe draft composed. */
  safe: boolean;
  /** No raw offer/video/booking URL leaks into the customer-visible body. */
  noRawUrlInBody: boolean;
  /** No price/dollar amount appears in the default first-touch body. */
  noPriceInBody: boolean;
}

/** The persuasion BEAT order the offer page walks, each with a presence flag. */
export interface PersuasionOfferBeat { key: string; label: string; present: boolean }

export interface PersuasionOfferFlow {
  /** The hero title the page leads with — the experience frame, never the price/SKU. */
  heroTitle: string;
  heroSubline: string;
  /** True when the hero uses experience.offerHeroTitle (not a price/SKU headline). */
  heroLeadsWithExperience: boolean;
  /** The ordered beats: hero → evidence → video → solution → package → protections → price → CTA. */
  beats: PersuasionOfferBeat[];
  /** True when the exact price is visible on the page BEFORE the purchase step. */
  priceBeforeCheckout: boolean;
  priceLabel: string;
  /** Offer-readiness check #6 (opens with evidence, not price) passes. */
  opensWithEvidence: boolean;
  /** Offer-readiness check #10 (price visible before purchase) passes. */
  priceVisibleBeforePurchase: boolean;
}

export interface PersuasionPdfFlow {
  /** True when the PDF is renderable (≥1 evidence-backed finding). */
  renderable: boolean;
  /** True when §1 (evidence/experience) precedes §FINAL (price) in document order. */
  evidenceFirstPriceLast: boolean;
  /** The §1 opener the PDF leads with (== experienceFrame.emailOpener). */
  opener: string;
  /** The §FINAL price label — the ONLY place price appears in the document. */
  priceLabel: string;
  filename: string;
}

export interface PersuasionVideoFlow {
  /** Personalized walkthrough — ALWAYS honest MISSING (no generator; Part P is a SPEC). */
  personalizedStatus: string;
  personalizedDetail: string;
  /** The attempted-use framing the video WOULD carry, from the experience frame. */
  framing: string;
  attemptSupported: boolean;
  /** The separate evergreen explainer (never presented as the personalized video). */
  evergreenStatus: string;
}

export interface PersuasionFlowView {
  offerId: string;
  company: string;
  quickFixEligible: boolean;
  /** The single experience frame every surface derives its opener from. */
  experience: ExperienceFrame;
  email: PersuasionEmailFlow;
  offer: PersuasionOfferFlow;
  pdf: PersuasionPdfFlow;
  video: PersuasionVideoFlow;
  /** The readiness verdict — answers "is the prospect shown the problem before the price?". */
  readiness: ReadinessResult;
  /** The persuasion-policy version the readiness verdict + framing were computed under. */
  persuasionPolicyVersion: string;
  /** The canonical evidence version (stable across rebuilds of the same evidence). */
  evidenceVersion: string;
  /** True when NO blocker issue exists — the operator may approve with confidence. */
  understandsProblemBeforePrice: boolean;
}

const RAW_URL_RE = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/i;
const PRICE_RE = /\$\s?\d|\bdollars?\b|\b\d+\s?usd\b|\bflat\b/i;

/**
 * Assemble the read-only persuasion-flow preview for one prepared offer. Prefers the
 * STORED offer; returns null when no offer is stored. Every surface is derived from the
 * SAME fixed contracts the customer/operator surfaces already use — this view NEVER
 * fabricates an asset, a claim, or a price, and it performs NO send and NO charge.
 */
export async function persuasionFlowView(offerId: string): Promise<PersuasionFlowView | null> {
  const stored = await store.getOffer(offerId);
  if (!stored) return null;
  const offer = stored as unknown as QuickFixOffer;

  // ONE evidence truth → package (drives every surface below). Pass the persisted
  // personalized-video record so the video flow reports its true readiness.
  const evidence = await buildEvidencePackage(offer, { personalizedVideo: stored.personalizedVideo ?? null });
  const frame = experienceFrameForOffer(offer);
  const offerPath = `/offer/${stored.shareToken}`;
  const bookingUrl = ARTIFEX_IDENTITY.bookingUrl;

  // ── EMAIL: real composer + real attachment policy (no send). ──
  const attachments = await buildOutreachAttachments(offer, { recipientEmail: stored.recipientEmail, pkg: evidence });
  const videoLink = attachments.manifest.videoLinkUrl;
  const copy = composeOfferOutreach(offer, {
    buyUrl: offerPath,
    bookingUrl,
    videoUrl: videoLink ?? undefined,
  }, {
    assets: {
      pdf: attachments.manifest.pdf,
      video: attachments.manifest.video,
    },
  });
  const firstLine = copy.bodyText.split("\n\n")[0] ?? "";
  const email: PersuasionEmailFlow = {
    subject: copy.subject,
    firstLine,
    firstLineMatchesOpener: firstLine.trim() === frame.emailOpener.trim(),
    pdfAttachment: attachments.manifest.pdf,
    pdfReason: attachments.manifest.pdfReason,
    videoLink,
    offerLink: offerPath,
    primaryCta: copy.primaryCta,
    safe: copy.safe,
    noRawUrlInBody: !RAW_URL_RE.test(copy.bodyText),
    noPriceInBody: offer.quickFixEligible ? !PRICE_RE.test(copy.bodyText) : true,
  };

  // ── OFFER PAGE: the SAME model the customer page renders (via page-service). ──
  const view = await (await import("./page-service")).buildPublicOfferView(offerId, { preview: true });
  const model = view!.model;
  const beats: PersuasionOfferBeat[] = [
    { key: "hero", label: "Experience hero (what we tried / found)", present: !!model.experience?.offerHeroTitle },
    { key: "evidence", label: "Observed evidence (findings / screenshots)", present: (model.evidence?.length ?? 0) > 0 || (model.evidenceAssets?.findings?.length ?? 0) > 0 },
    { key: "video", label: "Explainer video (evergreen, labelled)", present: model.trustVideo?.present === true || (model.trustVideo?.script?.length ?? 0) > 0 },
    { key: "solution", label: "Proposed solution (the repair)", present: !!model.proposedSolution },
    { key: "package", label: "What's included (value stack)", present: (model.whatWeFix?.length ?? 0) > 0 },
    { key: "protections", label: "Process protections (integrity principles)", present: (model.integrityPrinciples?.length ?? 0) > 0 },
    { key: "price", label: "Fixed price (revealed after value)", present: !model.conversationOnly && !!model.priceLabel },
    { key: "cta", label: "Purchase CTA", present: model.checkout?.purchasable === true || !model.conversationOnly },
  ];
  // Reuse the offer-readiness checks (#6 opens-with-evidence, #10 price-before-purchase)
  // over the offer page copy in READING ORDER so the operator sees the same verdict the
  // send-gate uses — never a divergent hand-rolled judgment.
  const offerPageBlocks = [
    model.experience.offerHeroTitle,
    model.experience.offerHeroSubline,
    model.whatWeFound,
    model.proposedSolution,
    ...model.whatWeFix,
    ...(model.conversationOnly ? [] : [model.priceLabel]),
  ].filter(Boolean);
  const artifact: OfferArtifact = {
    offer,
    evidence,
    subject: copy.subject,
    emailBody: copy.bodyText,
    emailFirstSentence: firstLine,
    offerPageBlocks,
    checkoutCopy: model.conversationOnly ? null : `${model.priceLabel}. ${model.turnaround}`,
    checkoutPriceText: model.conversationOnly ? null : model.priceLabel,
    priceVisibleBeforePurchase: !model.conversationOnly,
    packageItems: model.whatWeFix,
    scopeItems: offer.scope.includedItems,
    protectionsCopy: model.integrityPrinciples.join(" "),
    protectionsFacts: { revisionPolicy: offer.scope.revisionPolicy, deliveryWindow: offer.scope.deliveryWindow },
    dependentAssets: [
      { kind: "diagnosticPdf", present: evidence.diagnosticPdf.status === "READY", generatedEvidenceVersion: stored.evidenceVersion ?? evidenceVersion(evidence) },
    ],
    screenshotsRequired: false,
  };
  const readiness = assessOfferReadiness(artifact);
  const offerFlow: PersuasionOfferFlow = {
    heroTitle: model.experience.offerHeroTitle,
    heroSubline: model.experience.offerHeroSubline,
    heroLeadsWithExperience: model.headline !== model.priceLabel && !PRICE_RE.test(model.experience.offerHeroTitle),
    beats,
    priceBeforeCheckout: !model.conversationOnly,
    priceLabel: model.priceLabel,
    opensWithEvidence: !readiness.issues.some((i) => i.surface === "openingFrame" && i.severity === "BLOCKER"),
    priceVisibleBeforePurchase: !readiness.issues.some((i) => i.surface === "priceVisibility" && i.severity === "BLOCKER"),
  };

  // ── PDF: the pure diagnostic doc model (evidence-first → price-last). ──
  const doc = assembleDiagnosticDoc(offer, evidence, stored.shareToken);
  const pdf: PersuasionPdfFlow = {
    renderable: doc.renderable,
    // §1 opener precedes §FINAL price by construction of the document model; confirm the
    // opener carries no price and the price lives only in the isolated pricing block.
    evidenceFirstPriceLast: !PRICE_RE.test(doc.opener.opener) && !!doc.pricing.priceLabel,
    opener: doc.opener.opener,
    priceLabel: doc.pricing.priceLabel,
    filename: attachments.manifest.filename,
  };

  // ── VIDEO: personalized is honest MISSING (Part P narration SPEC only). ──
  const video: PersuasionVideoFlow = {
    personalizedStatus: evidence.personalizedVideo.status,
    personalizedDetail: evidence.personalizedVideo.detail,
    framing: frame.emailOpener,
    attemptSupported: frame.attemptSupported,
    evergreenStatus: evidence.evergreenVideo.status,
  };

  return {
    offerId,
    company: stored.companyName,
    quickFixEligible: offer.quickFixEligible,
    experience: frame,
    email,
    offer: offerFlow,
    pdf,
    video,
    readiness,
    persuasionPolicyVersion: stored.persuasionPolicyVersion ?? PERSUASION_POLICY_VERSION,
    evidenceVersion: evidenceVersion(evidence),
    understandsProblemBeforePrice: readiness.ready,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL CUSTOMER JOURNEY PREVIEW (Part P) — a read-only, NO-SEND assembly that stitches
// the EXACT frozen artifacts the customer/operator surfaces already render, in the real
// order the prospect moves through them:
//   INBOX → EMAIL → PDF → OFFER HERO → WEBSITE EVIDENCE → PERSONALIZED VIDEO → REPAIR
//   → PACKAGE → PROTECTIONS → PRICE → CHECKOUT PREVIEW.
// It re-uses the SAME artifacts opportunityWorkspaceView assembles (one evidence truth,
// one composed email, one offer-page model) — it fabricates NO preview copy, and it
// performs NO send, NO charge, NO schedule, NO write.
//
// PERSONALIZED-VIDEO INVARIANT (Part AE 41-44, 56): the personalized diagnostic video
// step is placed BEFORE the evergreen "how it works" step, and the evergreen video is
// NEVER substituted into the personalized slot — a non-READY personalized video exposes
// its honest MISSING/STALE status instead of borrowing the evergreen asset.
// ─────────────────────────────────────────────────────────────────────────────

export type JourneyStepKind =
  | "INBOX" | "EMAIL" | "PDF" | "OFFER_HERO" | "WEBSITE_EVIDENCE"
  | "PERSONALIZED_VIDEO" | "REPAIR" | "PACKAGE" | "PROTECTIONS" | "PRICE"
  | "EVERGREEN_VIDEO" | "CHECKOUT";

export interface JourneyStep {
  kind: JourneyStepKind;
  /** Short nav label (Inbox · Email · PDF · Offer · Video · Price · Checkout groupings). */
  navLabel: string;
  /** The section heading rendered in the stitched journey. */
  title: string;
  /** Honest presence/readiness for this artifact (READY/MISSING/STALE/NOT_APPLICABLE). */
  status: AssetStatus;
  /** Plain operator-facing detail — never fabricated. */
  detail: string;
}

export interface JourneyView {
  offerId: string;
  company: string;
  quickFixEligible: boolean;
  /** The composed email exactly as the customer would receive it (rendered, not sent). */
  inbox: { fromName: string; fromEmail: string; to: string | null; subject: string };
  email: { bodyHtml: string; bodyText: string; safe: boolean; primaryCta: OfferOutreachCopy["primaryCta"]; offerPath: string; attachments: "none" };
  /** The on-demand diagnostic PDF route + readiness (READY only with ≥1 finding). */
  pdf: { status: AssetStatus; route: string | null; detail: string };
  /** The offer-page model the customer route renders (hero → evidence → video → …). */
  offerPage: import("./offer-page").OfferPageModel;
  /** The ONE evidence truth (screenshots + personalized video ref) shared by every step. */
  evidence: EvidencePackage;
  /** The PERSONALIZED diagnostic video ref — READY url only; never the evergreen. */
  personalizedVideo: EvidenceAssetRef;
  /** The SECONDARY evergreen explainer — supporting, never the personalized slot. */
  evergreenVideo: EvidenceAssetRef;
  /** The checkout PREVIEW — price + purchasability, but no charge is ever initiated. */
  checkout: { priceLabel: string; purchasable: boolean; conversationOnly: boolean; reasons: string[] };
  /** The ordered steps stitched together — the exact customer sequence. */
  steps: JourneyStep[];
  /** Index of the personalized-video step and the evergreen step, for the invariant check. */
  personalizedVideoStepIndex: number;
  evergreenVideoStepIndex: number;
  /** True when the personalized step precedes the evergreen step AND the evergreen asset is
   *  never the one bound into the personalized slot (Part AE 41-44, 56). */
  personalizedBeforeEvergreen: boolean;
}

/**
 * Assemble the full read-only customer-journey preview for a stored offer. Reuses the
 * SAME frozen artifacts opportunityWorkspaceView assembles (one evidence package with the
 * offer's true personalized-video readiness, one composed email, one offer-page model) so
 * nothing here is fake preview copy. Returns null when no offer is stored. NO send, NO
 * charge, NO write.
 */
export async function journeyView(offerId: string): Promise<JourneyView | null> {
  const w = await opportunityWorkspaceView(offerId);
  if (!w) return null;

  const evidence = w.evidence;
  const model = w.offerPage;
  const personalizedVideo = evidence.personalizedVideo;
  const evergreenVideo = evidence.evergreenVideo;

  // The personalized slot NEVER borrows the evergreen asset: its url is used only when the
  // personalized ref itself is READY. This is the guard Part AE 41-44/56 assert.
  const pvReady = personalizedVideo.status === "READY" && !!personalizedVideo.url;
  const personalizedUrlBorrowsEvergreen =
    !!personalizedVideo.url && personalizedVideo.url === evergreenVideo.url;

  const steps: JourneyStep[] = [
    {
      kind: "INBOX", navLabel: "Inbox", title: "Inbox — the email lands",
      status: w.email.safe ? "READY" : "MISSING",
      detail: `From ${w.email.header.fromName} <${w.email.header.fromEmail}> · Subject: ${w.email.header.subject}`,
    },
    {
      kind: "EMAIL", navLabel: "Email", title: "Email — opened",
      status: w.email.safe ? "READY" : "MISSING",
      detail: w.email.safe ? "A fabrication-safe offer email composes. No attachments — nothing is auto-attached." : "No fabrication-safe offer email composes for this offer yet.",
    },
    {
      kind: "PDF", navLabel: "PDF", title: "Diagnostic PDF — the written review",
      status: evidence.diagnosticPdf.status,
      detail: evidence.diagnosticPdf.detail,
    },
    {
      kind: "OFFER_HERO", navLabel: "Offer", title: "Offer page — experience hero",
      status: "READY",
      detail: model.experience.offerHeroTitle,
    },
    {
      kind: "WEBSITE_EVIDENCE", navLabel: "Offer", title: "Website evidence — your live pages",
      status: evidence.screenshotStatus,
      detail: evidence.screenshotStatus === "READY"
        ? `${evidence.screenshots.filter((s) => s.status === "READY").length} captured page image(s) of the real site.`
        : "No captured screenshot is ready — the page shows the text evidence card instead (never a fabricated image).",
    },
    {
      kind: "PERSONALIZED_VIDEO", navLabel: "Video", title: "Personalized diagnostic video — about your site",
      status: personalizedVideo.status,
      detail: pvReady
        ? personalizedVideo.detail
        : `${personalizedVideo.detail} The evergreen explainer is NOT substituted here.`,
    },
    {
      kind: "REPAIR", navLabel: "Offer", title: "The repair — the proposed change",
      status: model.proposedSolution ? "READY" : "MISSING",
      detail: model.proposedSolution || "No proposed solution on this offer.",
    },
    {
      kind: "PACKAGE", navLabel: "Offer", title: "What's included — the value stack",
      status: model.whatWeFix.length ? "READY" : "MISSING",
      detail: model.whatWeFix.length ? `${model.whatWeFix.length} included item(s) — scope only, no invented bonuses.` : "No included items on this offer.",
    },
    {
      kind: "PROTECTIONS", navLabel: "Offer", title: "How the process is protected",
      status: model.integrityPrinciples.length ? "READY" : "MISSING",
      detail: `${model.integrityPrinciples.length} operational protection(s). Revisions: ${model.revisionPolicy}.`,
    },
    {
      kind: "PRICE", navLabel: "Price", title: "Price — one fixed price, before checkout",
      status: model.conversationOnly ? "NOT_APPLICABLE" : (model.priceLabel ? "READY" : "MISSING"),
      detail: model.conversationOnly ? "This offer is a conversation, not a fixed-price quick fix." : `${model.priceLabel} · ${model.turnaround}`,
    },
    {
      kind: "EVERGREEN_VIDEO", navLabel: "Video", title: "How the Artifex quick fix works (evergreen)",
      status: evergreenVideo.status,
      detail: `Secondary, shared explainer — the same for every customer, never about this site. ${evergreenVideo.detail}`,
    },
    {
      kind: "CHECKOUT", navLabel: "Checkout", title: "Checkout — preview only (no charge)",
      status: model.checkout.purchasable ? "READY" : "MISSING",
      detail: model.conversationOnly
        ? "Conversation offer — no checkout. Book a conversation instead."
        : `${model.priceLabel} · ${model.checkout.purchasable ? "purchasable" : "not purchasable"}: ${model.checkout.reasons.join("; ")}. This preview initiates NO charge.`,
    },
  ];

  const personalizedVideoStepIndex = steps.findIndex((s) => s.kind === "PERSONALIZED_VIDEO");
  const evergreenVideoStepIndex = steps.findIndex((s) => s.kind === "EVERGREEN_VIDEO");
  const personalizedBeforeEvergreen =
    personalizedVideoStepIndex >= 0 &&
    evergreenVideoStepIndex > personalizedVideoStepIndex &&
    !personalizedUrlBorrowsEvergreen;

  return {
    offerId,
    company: w.company,
    quickFixEligible: w.quickFixEligible,
    inbox: {
      fromName: w.email.header.fromName,
      fromEmail: w.email.header.fromEmail,
      to: w.email.header.to,
      subject: w.email.header.subject,
    },
    email: {
      bodyHtml: w.email.bodyHtml,
      bodyText: w.email.bodyText,
      safe: w.email.safe,
      primaryCta: w.email.primaryCta,
      offerPath: w.email.offerPath,
      attachments: "none",
    },
    pdf: {
      status: evidence.diagnosticPdf.status,
      route: evidence.diagnosticPdf.status === "READY" ? evidence.diagnosticPdf.url : null,
      detail: evidence.diagnosticPdf.detail,
    },
    offerPage: model,
    evidence,
    personalizedVideo,
    evergreenVideo,
    checkout: {
      priceLabel: model.priceLabel,
      purchasable: model.checkout.purchasable,
      conversationOnly: model.conversationOnly,
      reasons: model.checkout.reasons,
    },
    steps,
    personalizedVideoStepIndex,
    evergreenVideoStepIndex,
    personalizedBeforeEvergreen,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — OPERATOR-FACING QA GATE (read-only). Runs the finished adversarial
// pre-flight engine over a REAL stored offer (single) or the top-N high-confidence
// READY_TO_SELL offers (batch), and returns the structured verdict(s) the operator
// UI renders. Breakbot NEVER approves, sends, charges, schedules, or mutates — it is
// purely a QA verdict computed from read-only stored state + the fixed contracts.
//
// CRITICAL DISTINCTION (asset vs. sales readiness): a Breakbot verdict is about the
// ASSET / EXPERIENCE integrity of the assembled customer journey (assets generated,
// current, correctly bound, honest, safe). It is NOT the SALES qualification of the
// lead. An offer can be fully SALES-QUALIFIED (commercial fit, contactable, evidence)
// while an ASSET is still ungenerated. We surface both dimensions independently and
// NEVER downgrade sales qualification because an asset is not yet built.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble the read-only BreakbotPreflightInput for a STORED offer, the SAME way the
 * customer/operator surfaces assemble the journey: ONE evidence package, the offer's
 * bound evergreen video, and honest safe observations for the assisted checks. This
 * performs NO send, NO charge, NO write — it only reads stored state + fixed contracts.
 *
 * The assisted observations (approval/checkout/fulfillment) are set to the SAFE baseline
 * the production system is designed to honor (approval causes 0 sends/0 schedules; the
 * checkout is a preview config bound to the server price; a demo is not counted). These
 * describe the intended safe behavior; Breakbot proves the assembled artifacts uphold it.
 */
async function breakbotInputForStoredOffer(stored: store.StoredOffer): Promise<BreakbotPreflightInput> {
  const offer = stored as unknown as QuickFixOffer;
  // Pass the offer's persisted personalized-video record so the evidence package resolves
  // its TRUE readiness (READY/STALE/MISSING) — without it Breakbot always sees MISSING.
  const evidence = await buildEvidencePackage(offer, { personalizedVideo: stored.personalizedVideo ?? null });
  const ev = evidenceVersion(evidence);
  const videoAsset = trustVideoForOffer(offer).asset;

  // ── PRESENTATION READINESS (fail-closed trust/explainer video) ───────────────
  // The customer's "How the Artifex quick fix works" experience must carry the REAL journey-coherent
  // trust/explainer video — a Matt journey needs its Matt trust video, a Lucas journey its legacy Lucas
  // asset — never a transcript-only substitute. We attach the presentation group ONLY when the
  // personalized diagnostic video is already READY (the near-sendable offers); an offer without a ready
  // personalized video is already blocked upstream, so this adds the missing-trust-video BLOCKER exactly
  // where it matters without changing verdicts for offers that are blocked for other reasons. A
  // conversation-only offer has no video journey, so it is exempt.
  const pvReady = evidence.personalizedVideo.status === "READY";
  const conversationOnly = !offer.quickFixEligible;
  const pvRec = stored.personalizedVideo ?? null;
  let presentation: BreakbotPreflightInput["presentation"] | undefined;
  if (pvReady && !conversationOnly) {
    const journeyTrust = await resolveJourneyTrustVideo(offer);
    const served = personalizedVideoServedPaths(offer.offerId);
    presentation = {
      personalizedVideo: {
        status: "READY",
        mp4Key: pvRec?.mp4Key ?? null,
        mp4Url: pvRec?.mp4Url ?? served.mp4Url,
        posterKey: pvRec?.posterKey ?? null,
        durationSeconds: pvRec?.durationSeconds ?? null,
        voiceGeneration: pvRec?.voiceGeneration ?? journeyTrust.generation,
        // A READY render resolves through the served route when it has a durable object key.
        servedUrlResolves: !!pvRec?.mp4Key,
      },
      trust: {
        outcome: journeyTrust.outcome,
        generation: journeyTrust.generation,
        assetUrl: journeyTrust.assetUrl,
        mattTrustMissing: journeyTrust.mattTrustMissing,
        orientation: journeyTrust.orientation,
      },
      customerAssetUrls: [served.mp4Url, journeyTrust.assetUrl].filter((u): u is string => !!u),
    };
  }
  const dependentAssets: DependentAsset[] = [
    { kind: "diagnosticPdf", present: evidence.diagnosticPdf.status === "READY", generatedEvidenceVersion: stored.evidenceVersion ?? ev },
    // The personalized diagnostic video is a dependent asset: present ONLY when the
    // record resolved READY; its generated-against evidence version is the record's own.
    { kind: "personalizedVideo", present: evidence.personalizedVideo.status === "READY", generatedEvidenceVersion: stored.personalizedVideo?.evidenceVersion ?? null },
  ];
  return {
    offer,
    evidence,
    dependentAssets,
    evergreen: null,
    approvedSubject: stored.approvedSubjectFrozen ?? stored.subjectSelected ?? null,
    videoAsset,
    presentation,
    screenshotsRequired: false,
    // Safe assisted observations — the intended production behavior Breakbot verifies.
    approval: {
      sendsCausedByApprove: 0,
      schedulesCausedByApprove: 0,
      sendIsExplicit: true,
      scheduleIsExplicit: true,
      approvedEvidenceVersion: stored.evidenceVersion ?? ev,
    },
    checkout: {
      checkoutSku: offer.capabilityKeys[0] ?? null,
      checkoutPriceCents: offer.priceCents,
      managedPayments: false,
      webhookAuthoritative: true,
      liveCharge: false,
    },
    demo: { isDemo: false, countedTowardRevenue: false },
    fulfillment: { jobState: "PAID", accessReceived: true, preChangeCaptured: true, customer: null, customerPortalPresent: true },
    operatorView: { websiteUrl: evidence.websiteUrl, legacyFrozenShownActive: false },
    sellable: offer.quickFixEligible,
  };
}

/**
 * breakbotVerdictView — run the adversarial pre-flight over ONE real stored offer and
 * return its verdict. Null when no offer is stored for the id. Read-only; no sends.
 */
export async function breakbotVerdictView(offerId: string): Promise<BreakbotVerdict | null> {
  const stored = await store.getOffer(offerId);
  if (!stored) return null;
  const input = await breakbotInputForStoredOffer(stored);
  return runBreakbotPreflight(input);
}

// ── Batch verdict shapes (Part V surface) ────────────────────────────────────────
export interface BreakbotBatchRow {
  offerId: string;
  company: string;
  priceCents: number | null;
  confidence: number;
  /** ASSET/EXPERIENCE readiness — the Breakbot verdict (READY only when 0 blockers). */
  assetReady: boolean;
  blockers: number;
  warnings: number;
  passed: number;
  /** The distinct blocker surfaces on this offer (empty when READY). */
  blockerSurfaces: string[];
  /**
   * SALES qualification — independent of asset readiness. True when the lead is
   * commercially sellable (fit / contactable / evidence). NEVER downgraded because an
   * asset is ungenerated. Null when the lead context could not be qualified.
   */
  salesQualified: boolean | null;
}

export interface BreakbotBatchView {
  /** How many high-confidence READY_TO_SELL offers were scanned. */
  scanned: number;
  /** Offers whose ASSET journey passed Breakbot (0 blockers). */
  assetReadyCount: number;
  /** Offers whose ASSET journey has ≥1 blocker. */
  assetBlockedCount: number;
  /** SALES-QUALIFIED count — the sellable population (independent of asset readiness). */
  salesQualifiedCount: number;
  /**
   * The honest split the operator must not conflate: an offer can be SALES-QUALIFIED
   * yet ASSET-BLOCKED (sell-ready lead, unbuilt/ stale asset) — that is a build task,
   * NOT a disqualification. We count that intersection explicitly.
   */
  salesQualifiedButAssetBlocked: number;
  /** Aggregated most-common blocker surfaces across the batch (descending). */
  commonBlockers: Array<{ surface: string; count: number }>;
  rows: BreakbotBatchRow[];
}

/**
 * breakbotBatchView — run Breakbot over the top-N high-confidence READY_TO_SELL offers
 * from the live inventory and return the per-offer READY/BLOCKED verdicts + the
 * aggregated common blockers + the SALES-QUALIFIED vs ASSET-READY split. Read-only:
 * no sends, no charges, no writes. Sales qualification is computed separately (via the
 * qualification adapter) and is NEVER downgraded by an ungenerated/ stale asset.
 */
export async function breakbotBatchView(limit = 10): Promise<BreakbotBatchView> {
  // The population Breakbot QAs = the READY_TO_SELL, high-confidence STORED offers. We
  // qualify each lead independently so sales qualification is orthogonal to asset QA.
  const contexts = await buildLeadContexts(1000);
  const byLead = new Map<string, LeadContext>();
  for (const c of contexts) byLead.set(c.lead.id, c);

  const check = await buildSuppressionChecker();
  const isSuppressed = (site: string | undefined): boolean => {
    let domain: string | null = null;
    if (site) { try { domain = new URL(site.startsWith("http") ? site : `https://${site}`).hostname.replace(/^www\./, ""); } catch { domain = null; } }
    return !!domain && check({ domain });
  };

  const stored = await store.listOffers();
  // High-confidence, quick-fix-eligible, ranked by confidence desc → take top-N.
  const candidates = stored
    .filter((o) => o.quickFixEligible)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, limit));

  const rows: BreakbotBatchRow[] = [];
  const blockerCounts = new Map<string, number>();

  for (const s of candidates) {
    const input = await breakbotInputForStoredOffer(s);
    const verdict = runBreakbotPreflight(input);
    const blockerSurfaces = Array.from(new Set(verdict.issues.filter((i) => i.severity === "BLOCKER").map((i) => i.surface)));
    for (const surface of blockerSurfaces) blockerCounts.set(surface, (blockerCounts.get(surface) ?? 0) + 1);

    // SALES qualification — orthogonal to Breakbot. Computed from the lead context so an
    // ungenerated asset can NEVER downgrade a sales-qualified lead. Null if no context.
    let salesQualified: boolean | null = null;
    const ctx = byLead.get(s.leadId);
    if (ctx) {
      const q = qualifyLeadRecord({ lead: ctx.lead, offer: ctx.offer, bi: ctx.bi, suppressed: isSuppressed(ctx.lead.website) });
      salesQualified = q.qualification.readyToSell; // NOT readyToSend — asset readiness excluded on purpose.
    }

    rows.push({
      offerId: s.offerId,
      company: s.companyName,
      priceCents: s.quickFixEligible ? s.priceCents : null,
      confidence: s.confidence,
      assetReady: verdict.overall === "READY",
      blockers: verdict.counts.blockers,
      warnings: verdict.counts.warnings,
      passed: verdict.counts.passed,
      blockerSurfaces,
      salesQualified,
    });
  }

  const assetReadyCount = rows.filter((r) => r.assetReady).length;
  const salesQualifiedCount = rows.filter((r) => r.salesQualified === true).length;
  const salesQualifiedButAssetBlocked = rows.filter((r) => r.salesQualified === true && !r.assetReady).length;
  const commonBlockers = Array.from(blockerCounts.entries())
    .map(([surface, count]) => ({ surface, count }))
    .sort((a, b) => b.count - a.count);

  return {
    scanned: rows.length,
    assetReadyCount,
    assetBlockedCount: rows.length - assetReadyCount,
    salesQualifiedCount,
    salesQualifiedButAssetBlocked,
    commonBlockers,
    rows,
  };
}

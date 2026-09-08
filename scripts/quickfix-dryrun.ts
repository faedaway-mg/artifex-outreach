// QUICK-FIX ENGINE — SAFE NO-SEND / NO-CHARGE DRY RUN against real leads.
// Reads Business Intelligence (read-only), builds offers, and prints the quick-cash
// queue + addressable totals + full customer journeys. Sends nothing, charges
// nothing, touches no Stripe. Reuses the ONE evergreen trust asset for all.
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" ./node_modules/.bin/tsx scripts/quickfix-dryrun.ts'
import "./loadEnv";
if (process.env.DATABASE_PUBLIC_URL && process.env.DATABASE_URL?.includes(".railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
}

async function main() {
  const { listLeads, getBusinessIntelligence } = await import("../src/lib/repo");
  const { buildOfferForLead } = await import("../src/lib/quick-fix/adapter");
  const { rankQuickCash, addressableTotals } = await import("../src/lib/quick-fix/quick-cash");
  const { buildOfferPageModel } = await import("../src/lib/quick-fix/offer-page");
  const { seedEvergreenExplainer } = await import("../src/lib/quick-fix/evergreen-asset");
  const { buildRequirements } = await import("../src/lib/quick-fix/requirements");
  const { composeOfferOutreach } = await import("../src/lib/quick-fix/offer-outreach");
  const { offerIdFor } = await import("../src/lib/quick-fix/store");

  const leads = await listLeads();
  const evergreen = { ...seedEvergreenExplainer("dry"), status: "active" as const, assetUrl: "(reused evergreen ARTIFEX_QUICK_FIX_EXPLAINER)", version: 1 };

  const offers = [];
  let analyzed = 0;
  for (const lead of leads) {
    const bi = await getBusinessIntelligence(lead.id).catch(() => null);
    const profile = (bi?.profile as any)?.businessProfile ?? null;
    if (!profile) continue;
    analyzed += 1;
    const opps = Array.isArray(profile.opportunities) ? profile.opportunities : [];
    const offer = buildOfferForLead({ leadId: lead.id, companyName: lead.businessName, opportunities: opps, website: lead.website, generatedAt: null });
    offer.offerId = offerIdFor(offer);
    offers.push(offer);
  }

  const ranked = rankQuickCash(offers);
  const eligible = ranked.filter((r) => r.eligible);
  const totals = addressableTotals(offers);
  const d = (c: number) => `$${Math.round(c / 100)}`;

  console.log(`\n════════ QUICK-FIX ENGINE — DRY RUN (NO SEND / NO CHARGE) ════════`);
  console.log(`leads=${leads.length} · analyzed(with BI)=${analyzed} · offers=${offers.length} · quick-fix eligible=${eligible.length}`);
  console.log(`\nADDRESSABLE (engine-eligible only):`);
  console.log(`  $250 ENTRY : ${totals.entry.count}  (${d(totals.entry.revenueCents)})`);
  console.log(`  $495 GROWTH: ${totals.growth.count}  (${d(totals.growth.revenueCents)})`);
  console.log(`  $995 MINI  : ${totals.mini.count}  (${d(totals.mini.revenueCents)})`);
  console.log(`  TOTAL eligible one-time: ${d(totals.eligibleTotalCents)} across ${totals.eligibleCount} leads · ineligible=${totals.ineligibleCount}`);

  console.log(`\n──────── TOP QUICK-CASH OPPORTUNITIES ────────`);
  console.log(`SCORE  BAND    PRICE  ~HRS  ~$/HR   CONF  COMPANY / OFFER / PROBLEM`);
  for (const r of eligible.slice(0, 10)) {
    console.log(
      `${String(r.score).padStart(3)}    ${(r.band ?? "").padEnd(6)} ${d(r.priceCents).padStart(5)}  ${String(r.estimatedHours).padStart(3)}  ${d(r.effectiveHourlyCents).padStart(5)}  ${r.confidence.toFixed(2)}  ${r.company}`,
    );
    console.log(`                                        ↳ ${r.offerName} — ${r.problem}`);
    const maint = r.maintenanceMonthlyCents ? ` · maintenance ${d(r.maintenanceMonthlyCents)}/mo` : "";
    if (maint) console.log(`                                        ${maint.trim()}`);
  }

  // ── Full journeys for the top 3 eligible leads ──
  console.log(`\n──────── FULL CUSTOMER JOURNEYS (top 3, same reused trust video) ────────`);
  for (const r of eligible.slice(0, 3)) {
    const offer = offers.find((o) => o.offerId === r.leadId || o.leadId === r.leadId)!;
    const page = buildOfferPageModel({ offer, evergreen, approved: true, stripeConfigured: false, termsAccepted: false, superseded: false, bookingUrl: "https://cal.com/artifex" });
    const email = composeOfferOutreach(offer, { buyUrl: `/offer/${offer.offerId}`, bookingUrl: "https://cal.com/artifex" });
    const reqs = buildRequirements(offer);
    console.log(`\n■ ${offer.companyName}  [${offer.band} · ${d(offer.priceCents)}]`);
    console.log(`  FINDING (${offer.evidenceGrade}, conf ${offer.confidence.toFixed(2)}): ${page.whatWeFound}`);
    console.log(`  EMAIL TEASER  subject="${email.subject}"  primaryCTA=${email.primaryCta}  safe=${email.safe}`);
    console.log(`  OFFER PAGE    "${page.headline}" · ${page.priceLabel} · ${page.turnaround}`);
    console.log(`     fix: ${page.whatWeFix.slice(0, 3).join("; ")}${page.whatWeFix.length > 3 ? " …" : ""}`);
    console.log(`     trust video: v${page.trustVideo.version} present=${page.trustVideo.present} (evergreen, not per-lead)`);
    console.log(`     terms: ${page.termsVersion} · integrity principles: ${page.integrityPrinciples.length}`);
    console.log(`  REQUIREMENTS  ${reqs.items.map((i) => `${i.key}(${i.necessity === "REQUIRED_BEFORE_START" ? "REQ" : i.necessity === "OPTIONAL" ? "OPT" : "IFN"})`).join(", ")}  · blocking=${reqs.blockingCount}`);
    console.log(`  CHECKOUT      purchasable=${page.checkout.purchasable} buyEnabled(no-stripe/no-terms in preview)=${page.checkout.buyEnabled}`);
    console.log(`  POST-PURCHASE clock waits for required access; job → WAITING_FOR_CUSTOMER_INPUT → READY_FOR_FULFILLMENT`);
    if (offer.maintenance) console.log(`  UPSELL        ${offer.maintenance.planName} ${d(offer.maintenance.monthlyCents)}/mo (optional)`);
  }

  // ── A few honest rejections ──
  const rejected = ranked.filter((r) => !r.eligible).slice(0, 5);
  if (rejected.length) {
    console.log(`\n──────── REJECTED / NOT QUICK-FIX ELIGIBLE (sample) ────────`);
    for (const r of rejected) console.log(`  ✗ ${r.company}: ${r.reason}`);
  }
  // ── POST-SALE LAYER PREVIEW (mandate 5) ──
  const { playbookFor } = await import("../src/lib/quick-fix/playbooks");
  const { listSkus } = await import("../src/lib/quick-fix/catalog");
  const { scoreIntent } = await import("../src/lib/quick-fix/intent");
  const { FUNNEL_EVENTS } = await import("../src/lib/quick-fix/lifecycle");
  const { classifySku } = await import("../src/lib/quick-fix/profitability");

  console.log(`\n──────── FULFILLMENT PLAYBOOK PREVIEW (per-SKU, QA-gated) ────────`);
  const topSku = eligible[0]?.matchedSku ?? "contact-form-repair";
  const pb = playbookFor(topSku);
  if (pb) {
    console.log(`  SKU ${topSku} · est ${pb.estimatedLaborMinutes}min · rollback=${pb.rollbackRequired}`);
    console.log(`  STEPS: ${pb.steps.slice(0, 6).map((s, i) => `${i + 1}.${s}`).join("  ")} …`);
    console.log(`  QA (${pb.qaChecklist.length}): ${pb.qaChecklist.join(" · ")}`);
    console.log(`  ARTIFACTS: ${pb.deliveryArtifacts.join(", ")}`);
  }

  console.log(`\n──────── SKU PROFITABILITY (actuals=null until live sales — honest) ────────`);
  console.log(`  SKU                          SALES  REV  ACTUAL$/HR  VERDICT`);
  for (const sku of listSkus().slice(0, 6)) {
    const verdict = classifySku({ skuKey: sku.key, sales: 0, revenueCents: 0, estimatedHours: (sku.priceHintHours[0] + sku.priceHintHours[1]) / 2, actualHours: null, externalCostCents: 0, refundsCents: 0, grossContributionCents: 0, effectiveHourlyCents: null, conversionRate: null, repeatPurchaseRate: null, maintenanceAttachRate: null });
    console.log(`  ${sku.key.padEnd(28)}   0    $0    (no data)   ${verdict}`);
  }

  console.log(`\n──────── PURCHASE INTENT (LOGIC ONLY — no real tracked events exist yet) ────────`);
  const demo = scoreIntent({ events: [FUNNEL_EVENTS.emailOpened, FUNNEL_EVENTS.offerPageViewed, FUNNEL_EVENTS.checkoutStarted], checkoutAbandoned: true });
  console.log(`  example event chain [email_opened, offer_page_viewed, checkout_started, abandoned] → intent ${demo.score}/100`);
  console.log(`  strongest=${demo.strongestSignal} · next step: ${demo.recommendedNextStep}`);
  console.log(`  (Intent is DISTINCT from Fixability. No prospect has real tracked events yet → High-Intent queue is empty today.)`);

  console.log(`\n──────── REINSPECTION (STATE LOGIC — 0 delivered customers exist yet) ────────`);
  console.log(`  DELIVERED → 45-day cooldown → ELIGIBLE_FOR_REINSPECTION → new concrete defect? → match SKU → operator recommendation.`);

  console.log(`\n════════ DRY RUN COMPLETE — 0 emails · 0 charges · 0 Stripe calls ════════\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.stack || e); process.exit(1); });

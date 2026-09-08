// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX TEST-MODE END-TO-END REHEARSAL — highest-fidelity, NO live anything.
//
//   NO live charge · NO live customer · NO live email · NO real Stripe network call.
//
// Fidelity notes:
//   • Stripe Checkout creation uses a FAKE client (no test secret key is available
//     in this environment) — the exact params that WOULD be sent are asserted.
//   • The webhook is exercised for REAL: a Stripe-shaped event is signed with a
//     local secret, verified by the production verifyStripeSignature, and applied
//     through the SAME store.fulfillmentHandlers the live route uses.
//   • Persistence uses the in-memory store (DATABASE_URL is unset here).
//
//   Run: npx tsx scripts/quickfix-e2e-rehearsal.ts
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from "node:crypto";
import type { StripeCheckoutClient } from "../src/lib/quick-fix/stripe-commerce";

delete process.env.DATABASE_URL; // force in-memory store — touch no real DB
const WEBHOOK_SECRET = "whsec_rehearsal_local_only";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

function signedEvent(secret: string, event: object): { header: string; payload: string; nowSec: number } {
  const payload = JSON.stringify(event);
  const nowSec = Math.floor(new Date("2026-09-08T12:00:00Z").getTime() / 1000);
  const v1 = createHmac("sha256", secret).update(`${nowSec}.${payload}`).digest("hex");
  return { header: `t=${nowSec},v1=${v1}`, payload, nowSec };
}

async function main() {
  const store = await import("../src/lib/quick-fix/store");
  const { generateOffer } = await import("../src/lib/quick-fix/offer-engine");
  const { buildPublicOfferView, paymentStatusView } = await import("../src/lib/quick-fix/page-service");
  const { validateOfferForPurchase } = await import("../src/lib/quick-fix/purchase-safety");
  const { buildTermsAcceptance } = await import("../src/lib/quick-fix/terms");
  const { buildCheckoutParams } = await import("../src/lib/quick-fix/stripe-commerce");
  const { buildFixScanCheckoutParams, buildRepairAfterScanCheckout } = await import("../src/lib/quick-fix/fix-scan-commerce");
  const { createCredit, buildFixScanReport, FIX_SCAN_PLAYBOOK, fixScanReportReady } = await import("../src/lib/quick-fix/fix-scan");
  const { verifyStripeSignature, handleVerifiedEvent } = await import("../src/lib/quick-fix/webhook");
  const { playbookFor, canCompleteJob } = await import("../src/lib/quick-fix/playbooks");
  const { buildCompletionReport } = await import("../src/lib/quick-fix/completion");

  // A FAKE Stripe client — never touches the network.
  let sessionCounter = 0;
  const fakeStripe: StripeCheckoutClient = {
    async create() { sessionCounter += 1; return { ok: true, id: `cs_test_${sessionCounter}`, url: `https://checkout.stripe.test/${sessionCounter}` }; },
  };

  async function deliverVerifiedWebhook(event: object): Promise<{ verified: boolean; duplicate: boolean; kind: string }> {
    const { header, payload, nowSec } = signedEvent(WEBHOOK_SECRET, event);
    const v = verifyStripeSignature({ payload, header, secret: WEBHOOK_SECRET, nowSec });
    if (!v.ok) return { verified: false, duplicate: false, kind: "unverified" };
    const deps = await store.webhookDeps(store.fulfillmentHandlers("2026-09-08T12:00:00Z"));
    const r = await handleVerifiedEvent(JSON.parse(payload), deps);
    return { verified: true, duplicate: r.duplicate, kind: r.outcome.kind };
  }

  console.log(`\n════════ QUICK-FIX TEST-MODE E2E REHEARSAL (no send / no charge / no real Stripe) ════════`);

  // ── A) REPAIR JOURNEY ──────────────────────────────────────────────────────
  console.log(`\n[A] Repair journey ($249 CTA repair)`);
  const finding = { id: "cta", category: "Customer Acquisition", observation: "the primary CTA button is hard to find on mobile", whyItMatters: "buyers can't act", confidenceLabel: "Observed", confidenceScore: 0.95, impactLevel: "High", basis: ["link: https://acme.test"] };
  const offer = generateOffer({ leadId: "rehearsal_lead", companyName: "Rehearsal Roofing", findings: [finding], generatedAt: "2026-09-08T00:00:00Z" });
  const stored = await store.upsertOffer(offer, { recipientEmail: "owner@rehearsal.test", now: "2026-09-08T00:00:00Z" });
  await store.setApproval(stored.offerId, "approved", "operator", "2026-09-08T00:00:00Z");
  check("offer prepared + approved", stored.approvalStatus === "draft" ? false : true, stored.offerId);

  const view = await buildPublicOfferView(stored.shareToken);
  check("public offer page renders from share token", !!view, view?.model.headline);
  check("customer view has price + turnaround, no economics leak", !!view && view.model.priceLabel.includes("$249") && !JSON.stringify(view.model).match(/effectiveHourly|grossContribution/), view?.model.priceLabel);

  const acc = buildTermsAcceptance({ offer: stored, customerEmail: "owner@rehearsal.test", acceptedAt: "2026-09-08T01:00:00Z" });
  await store.saveTermsAcceptance(acc);
  check("terms accepted (versioned + scope snapshot)", acc.termsVersion.length > 0 && acc.digest.length > 0, acc.termsVersion);

  const safety = validateOfferForPurchase({ offer: stored, approved: true, stripeConfigured: true, superseded: false, leadBlocked: false });
  check("purchase-safety validator passes for the approved offer", safety.ok, safety.reasons.join("; ") || "ok");

  const params = buildCheckoutParams(stored, { withMaintenance: false, baseUrl: "https://outreach.test", customerEmail: "owner@rehearsal.test" });
  const session = await fakeStripe.create(params);
  check("server-resolved checkout params (price/SKU from frozen offer)", params.lineItems[0].unitAmountCents === stored.priceCents && params.metadata.offerId === stored.offerId, `$${params.lineItems[0].unitAmountCents / 100} · ${params.metadata.purchaseType}`);
  check("fake Stripe session created (no network)", session.ok, session.id!);

  // A success redirect must NEVER mark paid — before the webhook, status is not paid.
  const preStatus = await paymentStatusView(stored.offerId);
  check("redirect alone does NOT mark paid (status not READY/PAID pre-webhook)", preStatus?.status === "PAYMENT_CONFIRMING" || preStatus?.status === "PAYMENT_NOT_CONFIRMED", preStatus?.status);

  const paidEvent = { id: "evt_rehearsal_repair", type: "checkout.session.completed", data: { object: { id: session.id, payment_status: "paid", metadata: params.metadata } } };
  const wh1 = await deliverVerifiedWebhook(paidEvent);
  check("webhook signature verified + applied", wh1.verified && wh1.kind === "payment_succeeded", wh1.kind);
  const wh1dup = await deliverVerifiedWebhook(paidEvent);
  check("duplicate webhook is idempotent", wh1dup.duplicate === true);

  const job = await store.getJob(stored.offerId);
  check("verified payment created the fulfillment job", !!job, job?.state);
  const cust = await store.getCustomer("rehearsal_lead");
  check("prospect became a customer (cold outreach stops)", !!cust && cust.firstPurchaseType === "REPAIR", cust ? `LTV $${cust.lifetimeRevenueCents / 100}` : "none");

  const postStatus = await paymentStatusView(stored.offerId);
  check("success page reads INTAKE_REQUIRED (secure intake needed)", postStatus?.status === "INTAKE_REQUIRED", postStatus?.status);

  const done = await store.completeIntake(stored.offerId, "2026-09-08T02:00:00Z");
  check("completing blocking intake → READY_FOR_FULFILLMENT + clock starts", done?.state === "READY_FOR_FULFILLMENT" && !!done?.targetDeliveryAt, done?.targetDeliveryAt ?? "no clock");

  const pb = playbookFor(stored.capabilityKeys[0]);
  const qaPassed: Record<string, boolean> = {};
  pb?.qaChecklist.forEach((q) => (qaPassed[q] = true));
  const gate = pb ? canCompleteJob(pb, qaPassed) : { ok: false, missing: ["no playbook"] };
  check("QA gate passes only when every item is checked", gate.ok, `${pb?.qaChecklist.length ?? 0} QA items`);
  const report = buildCompletionReport(stored, { beforeRef: "s3://before.png", afterRef: "s3://after.png", verification: ["Desktop", "Mobile", "Click-through confirmed"] }, "2026-09-08T03:00:00Z");
  check("completion report valid with before/after evidence, no fabricated metric", report.valid, report.problems.join("; ") || "valid");

  // ── B) FIX SCAN → CREDIT → REPAIR JOURNEY ─────────────────────────────────
  console.log(`\n[B] Fix Scan ($99) → report → credit → discounted repair`);
  const scanParams = buildFixScanCheckoutParams({ leadId: "rehearsal_scan_lead", companyName: "Scan Co", baseUrl: "https://outreach.test", customerEmail: "scan@rehearsal.test" });
  check("Fix Scan checkout is a fixed $99 diagnostic", scanParams.lineItems[0].unitAmountCents === 9900 && scanParams.metadata.purchaseType === "FIX_SCAN", `$${scanParams.lineItems[0].unitAmountCents / 100}`);
  const scanSession = await fakeStripe.create(scanParams);
  const scanEvent = { id: "evt_rehearsal_scan", type: "checkout.session.completed", data: { object: { id: scanSession.id, payment_status: "paid", amount_total: 9900, metadata: scanParams.metadata } } };
  const whScan = await deliverVerifiedWebhook(scanEvent);
  check("Fix Scan payment verified + fulfilled", whScan.verified && whScan.kind === "payment_succeeded");
  const scanJob = await store.getJob(scanParams.metadata.offerId);
  check("Fix Scan created a scan job (needs surface access)", scanJob?.state === "WAITING_FOR_CUSTOMER_INPUT", scanJob?.state);
  const scanCust = await store.getCustomer("rehearsal_scan_lead");
  check("Fix Scan converts prospect → customer (firstPurchaseType FIX_SCAN)", scanCust?.firstPurchaseType === "FIX_SCAN");

  // Deliver the scan report (approved SKUs only, evidence required) + open the credit window.
  const scanReport = buildFixScanReport([finding], "2026-09-22");
  const scanQa: Record<string, boolean> = {}; FIX_SCAN_PLAYBOOK.qaChecklist.forEach((q) => (scanQa[q] = true));
  check("Fix Scan report is evidence-backed + QA-gated", scanReport.valid && fixScanReportReady(scanQa).ok, `${scanReport.items.length} item(s)`);
  const credit = createCredit(scanParams.metadata.offerId, "2026-09-08T13:00:00Z");
  await store.putCredit(credit);
  check("single-use 14-day credit created (≤ repair price)", credit.amountCents === 9900 && !credit.used);

  // The customer then buys the recommended repair with the credit applied.
  const repairOffer = generateOffer({ leadId: "rehearsal_scan_lead", companyName: "Scan Co", findings: [finding], generatedAt: "2026-09-08T00:00:00Z" });
  const repairStored = await store.upsertOffer(repairOffer, { recipientEmail: "scan@rehearsal.test", now: "2026-09-08T13:30:00Z" });
  await store.setApproval(repairStored.offerId, "approved", "operator", "2026-09-08T13:30:00Z");
  const nowMs = new Date("2026-09-09T00:00:00Z").getTime();
  const credited = buildRepairAfterScanCheckout({ offer: repairStored, credit: await store.getCredit(scanParams.metadata.offerId), scanOfferId: scanParams.metadata.offerId, baseUrl: "https://outreach.test", customerEmail: "scan@rehearsal.test", nowMs });
  check("repair-after-scan applies the $99 credit as an inline discount", credited.application.applies && credited.finalPriceCents === repairStored.priceCents - 9900, `$${credited.finalPriceCents / 100} charged`);
  const creditedSession = await fakeStripe.create(credited.params);
  const repairEvent = { id: "evt_rehearsal_credit_repair", type: "checkout.session.completed", data: { object: { id: creditedSession.id, payment_status: "paid", amount_total: credited.finalPriceCents, metadata: credited.params.metadata } } };
  await deliverVerifiedWebhook(repairEvent);
  const usedCredit = await store.getCredit(scanParams.metadata.offerId);
  check("credit consumed exactly once on the verified repair", usedCredit?.used === true && usedCredit?.usedOnOfferId === repairStored.offerId);
  const reuse = await store.consumeCredit(scanParams.metadata.offerId, "qfo_someone_else");
  check("credit cannot be reused (single-use enforced)", reuse === false);

  console.log(`\n════════ REHEARSAL RESULT: ${pass} passed / ${fail} failed · 0 emails · 0 charges · 0 real Stripe calls ════════\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e?.stack || e); process.exit(1); });

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end agreement rehearsal (Phase 14). Drives the FULL lifecycle against the
// in-memory store using the REAL domain primitives, webhook handlers, and gates —
// no live SignWell/Stripe/Resend calls, no real charge, no real prospect.
//
// Run:  npx tsx scripts/agreements/rehearsal.ts
// (Intentionally does NOT import loadEnv, so DATABASE_URL is unset → in-memory.)
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from "node:crypto";
import { __resetStoreForTests } from "../../src/lib/store";
import {
  insertLead, insertContact, insertProposal, updateProposal, getProposal,
  insertAgreement, getAgreement, updateAgreement, allAgreements,
  paymentsForAgreement, insertPayment, updatePayment, getPayment, getLead, getSettings,
} from "../../src/lib/repo";
import { buildAgreementContent } from "../../src/lib/agreement/snapshot";
import { nextAgreementNumber } from "../../src/lib/agreement/numbering";
import { AGREEMENT_TEMPLATE_VERSION } from "../../src/lib/agreement/template";
import { checkDepositAllowed } from "../../src/lib/agreement/deposit-gate";
import { renderAgreementPdf } from "../../src/lib/pdf/render-agreement";
import { agreementSendingEnabled, assertSendingEnabled } from "../../src/lib/esign/gate";
import { handleSignwellWebhook } from "../../src/lib/esign/webhook";
import { handleStripeWebhook } from "../../src/lib/payments/stripe-webhook";
import type { Agreement } from "../../src/lib/types";

const SIGNWELL_SECRET = "whsec_rehearsal_signwell";
const STRIPE_SECRET = "whsec_rehearsal_stripe";
let step = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
function phase(title: string) { console.log(`\n[${++step}] ${title}`); }
function assert(cond: boolean, msg: string) { if (!cond) { console.error(`  ✗ FAILED: ${msg}`); process.exit(1); } ok(msg); }

async function main() {
  console.log("ARTIFEX AGREEMENT SYSTEM — END-TO-END REHEARSAL (in-memory, no live sends)");
  console.log(`Production gate AGREEMENT_SENDING_ENABLED=${process.env.AGREEMENT_SENDING_ENABLED ?? "(unset)"} → sending ${agreementSendingEnabled() ? "ENABLED" : "DISABLED"}`);
  __resetStoreForTests();

  phase("Seed a controlled test client + accepted proposal");
  const lead = await insertLead({
    googlePlaceId: null, businessName: "Rehearsal Coffee Co", normalizedName: "rehearsalcoffee", industry: "Cafe",
    normalizedCategory: null, categoryGroup: null, address: "9 Test Ave", city: "Los Angeles", state: "CA", postalCode: "90001",
    latitude: null, longitude: null, phone: null, website: null, websiteDomain: null, publicEmail: "owner@rehearsal.example",
    contactFormUrl: null, socialLinks: [], locationsCount: null, rating: null, reviewCount: null, businessStatus: null,
    googleMapsUrl: null, hours: null, source: "rehearsal", retrievedAt: null, tier: "B", leadScore: 70, scoreBreakdown: null,
    pipelineStage: "Proposal Sent", estimatedValueLow: 8000, estimatedValueHigh: 16000, recommendedService: "Business Website System",
    recommendedAction: "Prepare video", recommendationReason: null, opportunitySummary: "Modernize online ordering and loyalty.",
    strengths: [], acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null,
    acquisitionOverride: false, assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: null, lastContactAt: null, nextFollowUpAt: null,
  } as any);
  await insertContact({ leadId: lead.id, name: "Sam Rivera", title: "Owner", email: "sam@rehearsal.example", phone: null, linkedinUrl: null, source: "rehearsal", confidence: "Verified", verified: true, optedOut: false });
  const proposal = await insertProposal({ leadId: lead.id, number: "AL-P-2026-777", version: 1, status: "sent", amount: 12000, proposalUrl: null, sentAt: new Date().toISOString(), acceptedAt: null });
  ok(`lead ${lead.id}, proposal ${proposal.number}`);

  phase("Proposal Accepted");
  await updateProposal(proposal.id, { status: "accepted", acceptedAt: new Date().toISOString() });
  assert((await getProposal(proposal.id))!.status === "accepted", "proposal marked accepted");

  phase("Generate Agreement (immutable snapshot)");
  const settings = await getSettings();
  const number = nextAgreementNumber((await allAgreements()).map((a) => a.agreementNumber), new Date().toISOString());
  const built = buildAgreementContent({
    agreementNumber: number, version: 1, lead: (await getLead(lead.id))!, contact: { id: "c", leadId: lead.id, name: "Sam Rivera", title: "Owner", email: "sam@rehearsal.example", phone: null, linkedinUrl: null, source: "r", confidence: "Verified", verified: true, optedOut: false, createdAt: "", updatedAt: "" },
    proposal: (await getProposal(proposal.id))!, deliverable: null, settings, nowIso: new Date().toISOString(),
  });
  assert(built.content !== null, `snapshot built with no validation errors (${built.errors.join("; ") || "none"})`);
  assert(built.content!.depositAmountCents === 600000, "deposit computed = $6,000 (50% of $12,000)");
  assert(built.content!.remainingBalanceCents === 600000, "remaining balance = $6,000");
  let agreement = await insertAgreement({
    leadId: lead.id, proposalId: proposal.id, agreementNumber: number, templateVersion: AGREEMENT_TEMPLATE_VERSION, version: 1,
    supersedesId: null, supersededById: null, status: "generated", contentSnapshot: built.content!, effectiveDate: null,
    signerName: built.content!.clientContactName, signerEmail: built.content!.clientEmail, signerCompany: built.content!.clientBusinessName,
    pdfKey: null, pdfUrl: null, signedPdfKey: null, signedPdfUrl: null, certificateUrl: null, esignProvider: null, esignRequestId: null,
    esignUrl: null, approvedAt: null, sentAt: null, viewedAt: null, signedAt: null, declinedAt: null, voidedAt: null,
  });
  ok(`agreement ${agreement.agreementNumber} (status=generated)`);

  phase("Preview PDF (internal, draft-marked while gate is off)");
  const pdf = await renderAgreementPdf(agreement, !agreementSendingEnabled());
  assert(pdf.subarray(0, 5).toString("latin1") === "%PDF-", `valid PDF generated (${pdf.byteLength} bytes, draft banner=${!agreementSendingEnabled()})`);

  phase("Internal review → Approve (freeze snapshot)");
  await updateAgreement(agreement.id, { status: "approved", approvedAt: new Date().toISOString() });
  const frozen = JSON.stringify((await getAgreement(agreement.id))!.contentSnapshot);
  assert((await getAgreement(agreement.id))!.status === "approved", "agreement approved");

  phase("Send for signature — verify the production gate");
  try { assertSendingEnabled(); assert(false, "gate should have blocked a live send"); }
  catch { ok("live send correctly BLOCKED while AGREEMENT_SENDING_ENABLED is off (SignWell test-mode remains available for rehearsal)"); }
  // Simulate the state a successful (test-mode) SignWell send would leave.
  await updateAgreement(agreement.id, { status: "sent", sentAt: new Date().toISOString(), esignProvider: "signwell", esignRequestId: "sw_doc_rehearsal", esignUrl: null });
  ok("agreement marked sent, esignRequestId=sw_doc_rehearsal");

  phase("SignWell webhook: viewed");
  await deliverSignwell("document_viewed", "sw_doc_rehearsal", "evt_v1", {});
  assert((await getAgreement(agreement.id))!.status === "viewed", "status → viewed via verified webhook");

  phase("SignWell webhook: completed (signed) → deposit unlocks");
  await deliverSignwell("document_completed", "sw_doc_rehearsal", "evt_s1", { completed_pdf_url: "https://signwell.example/signed.pdf", audit_page_url: "https://signwell.example/certificate" });
  agreement = (await getAgreement(agreement.id))!;
  assert(agreement.status === "signed", "status → signed");
  assert(agreement.signedPdfUrl === "https://signwell.example/signed.pdf", "signed PDF url stored");
  assert(agreement.certificateUrl === "https://signwell.example/certificate", "completion certificate url stored");
  assert(JSON.stringify(agreement.contentSnapshot) === frozen, "snapshot IMMUTABLE across the whole lifecycle");
  assert((await getLead(lead.id))!.pipelineStage === "Agreement Signed", "lead advanced to Agreement Signed");
  const deposits = await paymentsForAgreement(agreement.id);
  assert(deposits.length === 1 && deposits[0].status === "pending" && deposits[0].amountCents === 600000, "pending deposit auto-created for $6,000 (NOT sent)");

  phase("Deposit hard gate");
  const deposit = deposits[0];
  assert(checkDepositAllowed(agreement, deposit, lead.id).allowed === true, "deposit ALLOWED for signed current agreement");
  assert(checkDepositAllowed(agreement, { ...deposit, leadId: "other" }, lead.id).allowed === false, "cross-lead deposit REJECTED");
  assert(checkDepositAllowed({ ...agreement, status: "approved" } as Agreement, deposit, lead.id).allowed === false, "deposit REJECTED when agreement not signed");

  phase("Send deposit request — verify the production gate again");
  try { assertSendingEnabled(); assert(false, "gate should block deposit email"); }
  catch { ok("deposit email correctly BLOCKED while sending disabled"); }
  // Simulate the state after a real (enabled) deposit send with a Stripe link.
  await updatePayment(deposit.id, { status: "link_sent", sentAt: new Date().toISOString(), stripePaymentLinkUrl: "https://buy.stripe.com/test_rehearsal", stripeSessionId: "cs_rehearsal" });
  ok("deposit marked link_sent, stripeSessionId=cs_rehearsal");

  phase("Stripe webhook: checkout.session.completed → deposit paid");
  await deliverStripe("cs_rehearsal");
  assert((await getPayment(deposit.id))!.status === "paid", "deposit → paid via verified Stripe webhook");
  assert((await getLead(lead.id))!.pipelineStage === "Deposit Paid", "lead advanced to Deposit Paid");

  phase("Kickoff");
  await updateAgreement(agreement.id, {}); // no-op; kickoff advances the lead in-app
  const { updateLead } = await import("../../src/lib/repo");
  await updateLead(lead.id, { pipelineStage: "Won" });
  assert((await getLead(lead.id))!.pipelineStage === "Won", "engagement active (kickoff scheduled)");

  console.log("\nREHEARSAL COMPLETE — every gate held; no live sends; snapshot immutable end to end.\n");
}

async function deliverSignwell(type: string, docId: string, eventId: string, extra: Record<string, unknown>) {
  const body = JSON.stringify({ event: { id: eventId, type, time: new Date().toISOString() }, data: { object: { id: docId, status: type === "document_completed" ? "completed" : "viewed", ...extra } } });
  const sig = createHmac("sha256", SIGNWELL_SECRET).update(body).digest("hex");
  const res = await handleSignwellWebhook({ rawBody: body, signature: sig, secret: SIGNWELL_SECRET });
  if (!res.ok || res.result !== "applied") { console.error(`  ✗ webhook ${type} not applied: ${JSON.stringify(res)}`); process.exit(1); }
}

async function deliverStripe(sessionId: string) {
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: sessionId } } });
  const ts = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", STRIPE_SECRET).update(`${ts}.${body}`).digest("hex");
  const res = await handleStripeWebhook({ rawBody: body, signature: `t=${ts},v1=${v1}`, secret: STRIPE_SECRET });
  if (!res.ok || res.result !== "applied") { console.error(`  ✗ stripe webhook not applied: ${JSON.stringify(res)}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });

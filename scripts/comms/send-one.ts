// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — send exactly ONE internal test email through the real pipeline.
//
// Heavily guarded. It refuses to run unless:
//   • --to=<address> is given (the internal recipient),
//   • --yes-send-real-email is passed (explicit acknowledgement),
//   • a real provider is configured (RESEND_API_KEY → provider.canSend).
//
// It creates an isolated internal lead (source "Internal test") with a single
// approved, active plan + step, dispatches that one step, and prints the full
// trace. It never touches existing leads. Intended to be run with production env
// so the send goes through the live provider.
//
// Usage:
//   RESEND_API_KEY=... RESEND_FROM='Name <you@domain>' DATABASE_URL=... \
//   npx tsx scripts/comms/send-one.ts --to you@yourcompany.com --yes-send-real-email
import "../loadEnv";
import { insertLead, insertPlan, insertStep, emailSendsForPlan } from "../../src/lib/repo";
import { dispatchStep } from "../../src/lib/comms/dispatch";
import { conversationState } from "../../src/lib/comms/conversation";
import { getEmailProvider } from "../../src/lib/comms/provider";

const to = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1];
const ack = process.argv.includes("--yes-send-real-email");

function refuse(msg: string): never {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!to) refuse("no --to=<address> given.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) refuse(`--to is not a valid email: ${to}`);
  if (!ack) refuse("this SENDS A REAL EMAIL. Re-run with --yes-send-real-email to confirm.");
  const provider = getEmailProvider();
  if (!provider.canSend) refuse("provider is disabled (set RESEND_API_KEY + RESEND_FROM). Nothing sent.");

  console.log("\n" + "=".repeat(64));
  console.log(`SENDING ONE REAL TEST EMAIL via ${provider.name} → ${to}`);
  console.log("=".repeat(64));

  const lead = await insertLead({
    googlePlaceId: null, businessName: "Internal Test Send", normalizedName: `internaltest-${Date.now()}`, industry: "Internal",
    normalizedCategory: "internal", categoryGroup: "Internal", address: "—", city: "Los Angeles", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: null, websiteDomain: null,
    publicEmail: to, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: null, reviewCount: 0,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "Internal test", retrievedAt: null, tier: "C", leadScore: 50,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: null, estimatedValueHigh: null,
    recommendedService: null, recommendedAction: null, recommendationReason: null, opportunitySummary: "Internal deliverability test.", strengths: [],
    acquisitionStrategy: "Light", acquisitionScore: 50, acquisitionReason: "Internal test", acquisitionScoreBreakdown: null, acquisitionOverride: true,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: "Internal test send — safe to delete.", lastContactAt: null, nextFollowUpAt: null,
  } as any);

  const plan = await insertPlan({
    leadId: lead.id, strategy: "Light", objective: "Internal deliverability test", assetPackage: "Essential", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 1, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: new Date().toISOString(), startedAt: new Date().toISOString(), pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  });
  const step = await insertStep({
    planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0,
    subject: "Artifex Labs — internal deliverability test",
    content: "This is an internal test of the Artifex Labs outreach pipeline. If you received it, delivery works. {{unsubscribe}}",
    approvalRequired: false, approvalStatus: "approved", scheduledAt: new Date().toISOString(), sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  });

  const result = await dispatchStep(step.id);
  console.log(`\ndispatch outcome: ${result.outcome}`);
  console.log(`provider message id: ${result.providerMessageId ?? "—"}`);
  const sends = await emailSendsForPlan(plan.id);
  console.log(`ledger status: ${sends[0]?.status}`);

  const cs = await conversationState(lead.id);
  console.log(`conversation stage: ${cs.currentStage}`);
  console.log("\nNext, to watch the lifecycle advance (delivered → opened → clicked → replied):");
  console.log(`  • webhooks will update the ledger as events arrive from the provider`);
  console.log(`  • poll:  GET /api/comms/status  (Bearer CRON_SECRET)`);
  console.log(`  • lead id: ${lead.id}   plan id: ${plan.id}`);
  console.log(`\nTo remove this internal test lead afterwards, delete lead ${lead.id} (source \"Internal test\").`);
  process.exit(result.outcome === "sent" ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

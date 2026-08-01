// ─────────────────────────────────────────────────────────────────────────────
// Final customer-experience validation — send exactly ONE real branded outreach
// email through the EXACT production path a business would receive.
//
// Unlike send-one.ts (a plaintext deliverability probe), this runs the full product:
//   buildOutreachKit  → authenticity evaluator + observation-first writing
//   renderEmailHtml    → the branded constellation shell + signature
//   renderEmailText    → the plain-text alternative
//   dispatchStep       → threading headers (Message-ID/…) + From/Reply-To + provider
//
// It borrows a REAL business's profile for authentic content, but delivers to an
// isolated internal lead whose only address is the approved test inbox. It never
// touches real leads and never opens the global OUTREACH_SENDING_ENABLED gate.
//
// Usage:
//   railway run --service outreach-web -- env DATABASE_URL="<public>" \
//     ./node_modules/.bin/tsx scripts/comms/send-one-branded.ts \
//     --to you@domain.com --yes-send-real-email
// ─────────────────────────────────────────────────────────────────────────────
import "../loadEnv";
import { insertLead, insertPlan, insertStep, emailSendsForPlan, listLeads, getBusinessIntelligence, contactsForLead, getSettings } from "../../src/lib/repo";
import { buildOutreachKit } from "../../src/lib/outreach/kit";
import { renderEmailHtml, renderEmailText } from "../../src/lib/outreach/email-render";
import { scoreAuthenticity } from "../../src/lib/outreach/authenticity";
import { threadingHeaders, domainFromAddress } from "../../src/lib/comms/threading";
import { dispatchStep } from "../../src/lib/comms/dispatch";
import { getEmailProvider } from "../../src/lib/comms/provider";
import { inferDecisionMakers } from "../../src/lib/outreach/decision-maker";

const to = process.argv.find((a) => a.startsWith("--to="))?.split("=")[1];
const ack = process.argv.includes("--yes-send-real-email");
const refuse = (m: string): never => { console.error(`REFUSED: ${m}`); process.exit(1); };

async function main() {
  if (!to) refuse("no --to=<address> given.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to!)) refuse(`--to is not a valid email: ${to}`);
  if (!ack) refuse("this SENDS A REAL EMAIL. Re-run with --yes-send-real-email to confirm.");
  const provider = getEmailProvider();
  if (!provider.canSend) refuse("provider is disabled (set RESEND_API_KEY + RESEND_FROM). Nothing sent.");

  const settings = await getSettings();

  // ── Borrow a real business's profile so the content is authentic ────────────
  const leads = await listLeads();
  let source = null as null | Awaited<ReturnType<typeof listLeads>>[number];
  let profile: any = null;
  for (const l of leads) {
    const bi = await getBusinessIntelligence(l.id);
    const p = bi?.profile?.businessProfile;
    if (p && (p.opportunities?.length ?? 0) > 0) { source = l; profile = p; break; }
  }
  if (!source || !profile) refuse("no business with an intelligence profile found to model the email on.");

  const contacts = await contactsForLead(source!.id);
  const kit = buildOutreachKit({ lead: source!, profile, settings, contacts });
  const email = kit.email;

  // ── Gate: the authenticity evaluator must approve it ────────────────────────
  const auth = scoreAuthenticity(email);
  if (!auth.pass) {
    console.error("REFUSED: authenticity evaluator did not approve the generated email:");
    for (const c of auth.checks) if (!c.ok) console.error(`  ✗ ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
    process.exit(1);
  }

  // ── Render the exact branded HTML + plain-text the app would send ───────────
  const html = renderEmailHtml({ email, settings, businessName: source!.businessName, unsubscribeUrl: "{{unsubscribe}}" });
  const text = renderEmailText({ email, settings, unsubscribeUrl: "{{unsubscribe}}" });

  console.log("\n" + "=".repeat(64));
  console.log(`SENDING ONE REAL BRANDED OUTREACH EMAIL via ${provider.name} → ${to}`);
  console.log("=".repeat(64));

  // ── Isolated internal lead — delivery vehicle only, address = the test inbox ─
  const lead = await insertLead({
    googlePlaceId: null, businessName: "Branded Test Send", normalizedName: `brandedtest-${Date.now()}`, industry: "Internal",
    normalizedCategory: "internal", categoryGroup: "Internal", address: "—", city: "Los Angeles", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: null, website: null, websiteDomain: null,
    publicEmail: to!, contactFormUrl: null, socialLinks: [], locationsCount: 1, rating: null, reviewCount: 0,
    businessStatus: "OPERATIONAL", googleMapsUrl: null, hours: null, source: "Internal test", retrievedAt: null, tier: "C", leadScore: 50,
    scoreBreakdown: {} as any, pipelineStage: "Qualified", estimatedValueLow: null, estimatedValueHigh: null,
    recommendedService: null, recommendedAction: null, recommendationReason: null, opportunitySummary: "Final branded validation.", strengths: [],
    acquisitionStrategy: "Light", acquisitionScore: 50, acquisitionReason: "Internal test", acquisitionScoreBreakdown: null, acquisitionOverride: true,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: "Branded validation send — safe to delete.", lastContactAt: null, nextFollowUpAt: null,
  } as any);

  const plan = await insertPlan({
    leadId: lead.id, strategy: "Light", objective: "Final branded validation", assetPackage: "Essential", primaryChannel: "email", secondaryChannel: null,
    status: "active", approvalStatus: "approved", currentStep: 1, maxTouches: 1, nextScheduledAt: null, replyState: null,
    approvedBy: "jordan", approvedAt: new Date().toISOString(), startedAt: new Date().toISOString(), pausedAt: null, completedAt: null,
    pauseReason: null, stopReason: null, estimatedCost: 0, estimatedValueSnapshot: null, assetReadinessSnapshot: null,
    assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan",
  } as any);

  const step = await insertStep({
    planId: plan.id, stepNumber: 1, channel: "email", delayDays: 0,
    subject: email.subject, content: text, html,
    approvalRequired: false, approvalStatus: "approved", scheduledAt: new Date().toISOString(), sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null,
  } as any);

  // The threading headers dispatch will emit for this step (same function it uses).
  const domain = domainFromAddress(process.env.RESEND_FROM || settings.contactEmail || "hello@artifexlabs.tech");
  const headers = threadingHeaders(step as any, [step as any], domain);

  const result = await dispatchStep(step.id);
  const sends = await emailSendsForPlan(plan.id);

  console.log(`\n1. Provider acceptance:      ${result.outcome === "sent" ? "ACCEPTED" : result.outcome} (id ${result.providerMessageId ?? "—"}, ledger ${sends[0]?.status})`);
  console.log(`2. Subject:                  ${email.subject}`);
  console.log(`3. Branded HTML path used:   ${html.length > 0 && html.includes("Business technology partner") ? "YES — branded shell (not the probe)" : "NO"}  (html ${html.length} bytes, plaintext ${text.length} bytes)`);
  console.log(`4. Authenticity approved:    ${auth.pass ? "YES" : "NO"} (score ${auth.score}/100)`);
  console.log(`5. Threading headers emitted: Message-ID ${headers["Message-ID"]}${headers["References"] ? `, References ${headers["References"]}` : " (first email → anchor only)"}`);
  console.log(`6. Warnings:                 modeled on "${source!.businessName}" (real profile); isolated lead ${lead.id} (delete when done)`);
  console.log(`\nFrom: ${process.env.RESEND_FROM}   Reply-To: ${settings.contactEmail}`);
  process.exit(result.outcome === "sent" ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });

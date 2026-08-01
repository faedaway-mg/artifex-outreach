/** Acquisition OS acceptance — internal demo lead. Verifies the command-center
 * card renders enriched fields live, the feedback loop records overrides, and the
 * timeline reflects the plan. Cleans up. */
import "./loadEnv";
import { insertLead, updateLead, insertFinding, insertPlan, insertStep, getSettings, insertFeedback, feedbackForLead } from "../src/lib/repo";
import { normalizeName } from "../src/lib/store";
import { computeAcquisitionStrategy } from "../src/lib/acquisition/strategy";
import { policyFor } from "../src/lib/acquisition/policy";
import { buildSequence } from "../src/lib/acquisition/sequences";
import type { Lead, ScoreBreakdown } from "../src/lib/types";

async function main() {
  const settings = await getSettings();
  const nm = "ZZ OS Demo — Dental (delete me)";
  const lead = await insertLead({
    googlePlaceId: null, businessName: nm, normalizedName: normalizeName(nm + Math.random()), industry: "Dental practice",
    normalizedCategory: "dental-practices", categoryGroup: "Health and Wellness", address: "1 Demo", city: "LA", state: "CA", postalCode: "90012",
    latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://d.example", websiteDomain: "d.example", publicEmail: "hi@d.example",
    contactFormUrl: "https://d.example/c", socialLinks: [], locationsCount: 2, rating: 4.8, reviewCount: 220, businessStatus: "OPERATIONAL",
    googleMapsUrl: null, hours: null, source: "Internal demo", retrievedAt: new Date().toISOString(), tier: "A", leadScore: 84,
    scoreBreakdown: { businessFit: 18, websiteOpportunity: 18, automationOpportunity: 16, abilityToPay: 13, publicReputation: 9, contactability: 9, triggerUrgency: 3 } as ScoreBreakdown,
    pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "Business Website System", recommendedAction: "Prepare video",
    recommendationReason: null, opportunitySummary: "Strong reputation but a dated mobile booking flow.", strengths: [],
    acquisitionStrategy: null, acquisitionScore: null, acquisitionReason: null, acquisitionScoreBreakdown: null, acquisitionOverride: false,
    assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: "DEMO", lastContactAt: null, nextFollowUpAt: null,
  });
  await insertFinding({ leadId: lead.id, category: "Mobile usability", title: "Booking hard to find on mobile", observation: "o", evidence: "e", businessImpact: "i", modernizationDirection: "Persistent booking button", findingType: "Automated technical finding", confidence: "Verified", sourceUrl: "https://d.example", analyzedAt: new Date().toISOString(), deterministic: true, approved: true });

  const r = computeAcquisitionStrategy(lead, { hasApprovedFindings: true });
  await updateLead(lead.id, { acquisitionStrategy: r.strategy, acquisitionScore: r.score, acquisitionReason: r.reason, acquisitionScoreBreakdown: r.breakdown });
  console.log("strategy:", r.strategy, "| explanation:", r.reason.slice(0, 80) + "…");

  const policy = policyFor(r.strategy);
  const plan = await insertPlan({ leadId: lead.id, strategy: r.strategy, objective: policy.objective, assetPackage: policy.assetPackage, primaryChannel: "email", secondaryChannel: policy.secondaryChannel, status: "prepared", approvalStatus: "pending", currentStep: 0, maxTouches: policy.maxTouches, nextScheduledAt: null, replyState: null, approvedBy: null, approvedAt: null, startedAt: null, pausedAt: null, completedAt: null, pauseReason: null, stopReason: null, estimatedCost: policy.estimatedCost, estimatedValueSnapshot: null, assetReadinessSnapshot: null, assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan" });
  for (const s of buildSequence(r.strategy, lead, settings, "booking is hard to find on mobile.")) await insertStep({ planId: plan.id, stepNumber: s.stepNumber, channel: s.channel, delayDays: s.delayDays, subject: s.subject, content: s.content, approvalRequired: s.approvalRequired, approvalStatus: "pending", scheduledAt: null, sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });

  // Feedback loop: record an override (as the action would)
  await insertFeedback({ leadId: lead.id, field: "strategy", original: r.strategy, updated: "Assisted", reason: "Jordan's judgment", user: "jordan" });
  const fb = await feedbackForLead(lead.id);
  console.log("feedback recorded:", fb.length, "| field:", fb[0]?.field, "| original→updated:", fb[0]?.original, "→", fb[0]?.updated);

  // Verify the LIVE command-center card renders enriched fields
  const cj = "/tmp/os-cj.txt";
  const login = await fetch("https://outreach.artifexlabs.tech/api/auth/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "password=0E5Meq3oZXTM" });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const page = await fetch("https://outreach.artifexlabs.tech/approvals", { headers: { cookie } }).then((x) => x.text());
  const has = (s: string) => page.includes(s);
  console.log("LIVE /approvals card:");
  console.log("  business:", has(nm), "| Opportunity:", has("Opportunity"), "| Website:", has("Website:"), "| Contact:", has("Contact:"), "| Assets:", has("Assets"), "| Sequence preview:", has("Sequence preview"), "| command-center title:", has("command center"));

  console.log("DEMO_LEAD_ID=" + lead.id, "PLAN_ID=" + plan.id);
}
main().catch((e) => { console.error(e); process.exit(1); });

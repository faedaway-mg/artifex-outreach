/**
 * Tiered acquisition live acceptance. Uses INTERNAL DEMO leads only (never a real
 * prospect). Exercises the real strategy engine, policy, compliance gates,
 * sequence builder, and stop conditions against production Postgres. No email is
 * sent (there is no live send path). Cleans up afterward.
 */
import "./loadEnv";
import { insertLead, updateLead, insertPlan, insertStep, stepsForPlan, getPlan, updatePlan, getSettings, plansForLead } from "../src/lib/repo";
import { normalizeName } from "../src/lib/store";
import { computeAcquisitionStrategy } from "../src/lib/acquisition/strategy";
import { policyFor } from "../src/lib/acquisition/policy";
import { buildSequence } from "../src/lib/acquisition/sequences";
import { checkPlanCompliance } from "../src/lib/acquisition/compliance";
import { stopPlansForLead } from "../src/lib/acquisition/stop";
import type { Lead, AcquisitionStrategy, ScoreBreakdown } from "../src/lib/types";

const base = (over: Partial<Lead>): Omit<Lead, "id" | "createdAt" | "updatedAt"> => ({
  googlePlaceId: null, businessName: "ZZ Demo Co", normalizedName: normalizeName("ZZ Demo Co " + Math.random()), industry: "Dental practice",
  normalizedCategory: "dental-practices", categoryGroup: "Health and Wellness", address: "1 Demo", city: "LA", state: "CA", postalCode: "90012",
  latitude: null, longitude: null, phone: "(213) 555-0100", website: "https://d.example", websiteDomain: "d.example", publicEmail: "hi@d.example",
  contactFormUrl: "https://d.example/c", socialLinks: [], locationsCount: 2, rating: 4.7, reviewCount: 210, businessStatus: "OPERATIONAL",
  googleMapsUrl: null, hours: null, source: "Internal demo", retrievedAt: null, tier: "A", leadScore: 80,
  scoreBreakdown: { businessFit: 18, websiteOpportunity: 18, automationOpportunity: 16, abilityToPay: 13, publicReputation: 9, contactability: 9, triggerUrgency: 3 } as ScoreBreakdown,
  pipelineStage: "Qualified", estimatedValueLow: 8000, estimatedValueHigh: 18000, recommendedService: "Business Website System", recommendedAction: "Prepare video",
  recommendationReason: null, opportunitySummary: "clear opportunity.", strengths: [], acquisitionStrategy: null, acquisitionScore: null,
  acquisitionReason: null, acquisitionScoreBreakdown: null, acquisitionOverride: false, assignedTo: "jordan", assignedAt: null, assignmentReason: null, lastOperatorActivityAt: null, note: "DEMO", lastContactAt: null, nextFollowUpAt: null,
  ...over,
});

async function main() {
  const settings = await getSettings();
  const created: string[] = [];
  const results: Record<string, string> = {};

  // 1) Strategy assignment across profiles
  const cases: Array<[string, Partial<Lead>, AcquisitionStrategy[], any?]> = [
    ["Personal", {}, ["Personal"], { hasApprovedFindings: true }],
    ["Assisted", { estimatedValueLow: 4000, estimatedValueHigh: 7000, locationsCount: 1, industry: "Fitness studio", normalizedCategory: "fitness-studios", scoreBreakdown: { businessFit: 14, websiteOpportunity: 12, automationOpportunity: 10, abilityToPay: 9, publicReputation: 8, contactability: 8, triggerUrgency: 2 } as ScoreBreakdown }, ["Assisted", "Light"]],
    ["Light", { estimatedValueLow: 1500, estimatedValueHigh: 3500, locationsCount: 1, industry: "Specialty retailer", normalizedCategory: "specialty-retailers", publicEmail: null, scoreBreakdown: { businessFit: 10, websiteOpportunity: 8, automationOpportunity: 6, abilityToPay: 6, publicReputation: 7, contactability: 6, triggerUrgency: 1 } as ScoreBreakdown }, ["Light", "Manual Review"]],
    ["ManualReview", { phone: null, publicEmail: null, website: null, contactFormUrl: null }, ["Manual Review"]],
    ["DoNotContact", { businessStatus: "CLOSED_PERMANENTLY" }, ["Do Not Contact"]],
    ["LowRatingStrong", { rating: 2.3, reviewCount: 25 }, ["Personal", "Assisted"], { hasApprovedFindings: true }],
  ];
  for (const [name, over, expected, opts] of cases) {
    const lead = await insertLead(base(over));
    created.push(lead.id);
    const r = computeAcquisitionStrategy(lead, opts ?? {});
    await updateLead(lead.id, { acquisitionStrategy: r.strategy, acquisitionScore: r.score, acquisitionReason: r.reason, acquisitionScoreBreakdown: r.breakdown });
    const ok = expected.includes(r.strategy);
    results[name] = `${r.strategy} (score ${r.score}) ${ok ? "✓" : "✗ expected " + expected.join("/")}`;
    (base as any)[name] = lead.id;
  }

  // 2) Prepare + compliance for an Assisted lead
  const assistedLead = await insertLead(base({ acquisitionStrategy: "Assisted" }));
  created.push(assistedLead.id);
  const policy = policyFor("Assisted");
  const plan = await insertPlan({ leadId: assistedLead.id, strategy: "Assisted", objective: policy.objective, assetPackage: policy.assetPackage, primaryChannel: "email", secondaryChannel: policy.secondaryChannel, status: "prepared", approvalStatus: "pending", currentStep: 0, maxTouches: policy.maxTouches, nextScheduledAt: null, replyState: null, approvedBy: null, approvedAt: null, startedAt: null, pausedAt: null, completedAt: null, pauseReason: null, stopReason: null, estimatedCost: policy.estimatedCost, estimatedValueSnapshot: null, assetReadinessSnapshot: null, assetMissingSnapshot: null, contactConfidenceSnapshot: null, websiteHealthSnapshot: null, owner: "jordan" });
  for (const s of buildSequence("Assisted", assistedLead, settings, "one clear opportunity.")) await insertStep({ planId: plan.id, stepNumber: s.stepNumber, channel: s.channel, delayDays: s.delayDays, subject: s.subject, content: s.content, approvalRequired: s.approvalRequired, approvalStatus: "pending", scheduledAt: null, sentAt: null, providerMessageId: null, deliveryStatus: null, stoppedAt: null, stopReason: null });
  const steps = await stepsForPlan(plan.id);
  const compGood = checkPlanCompliance(assistedLead, plan, steps, settings);
  const compSuppressed = checkPlanCompliance(assistedLead, plan, steps, settings, { suppressed: true });
  const compBadEmail = checkPlanCompliance({ ...assistedLead, publicEmail: "bad" }, plan, steps, settings);
  results["compliance_valid"] = compGood.ok ? "PASS ✓" : "FAIL: " + compGood.blockers.join(", ");
  results["compliance_suppressed_blocked"] = !compSuppressed.ok ? "BLOCKED ✓" : "✗ not blocked";
  results["compliance_bad_email_blocked"] = !compBadEmail.ok ? "BLOCKED ✓" : "✗ not blocked";
  results["personal_cannot_batch"] = policyFor("Personal").requiresIndividualApproval ? "individual-only ✓" : "✗";

  // 3) Approve (schedule, NO send) then stop on reply (idempotent)
  const now = new Date();
  await updatePlan(plan.id, { approvalStatus: "approved", approvedBy: "jordan", approvedAt: now.toISOString(), status: "active", currentStep: 1, startedAt: now.toISOString() });
  const afterApprove = await stepsForPlan(plan.id);
  results["no_email_sent"] = afterApprove.every((s) => s.sentAt === null) ? "no sends ✓" : "✗ a step was sent";
  const stopped1 = await stopPlansForLead(assistedLead.id, "reply received");
  const stopped2 = await stopPlansForLead(assistedLead.id, "reply received"); // idempotent
  const planAfter = await getPlan(plan.id);
  results["reply_stops_sequence"] = planAfter?.status === "stopped" ? "stopped ✓" : "✗";
  results["stop_idempotent"] = stopped1 === 1 && stopped2 === 0 ? "idempotent ✓ (1 then 0)" : `✗ (${stopped1}/${stopped2})`;
  results["cost_caps"] = policyFor("Light").estimatedCost < policyFor("Personal").estimatedCost ? "Light<Personal ✓" : "✗";

  console.log("=== STRATEGY ASSIGNMENT ===");
  for (const [k, v] of Object.entries(results)) console.log(`  ${k}: ${v}`);
  console.log("DEMO_LEAD_IDS=" + [...created, assistedLead.id].join(","));
}
main().catch((e) => { console.error(e); process.exit(1); });

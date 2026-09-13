// ─────────────────────────────────────────────────────────────────────────────
// Launch Intelligence Dashboard — metrics (Phase 1).
//
// Measures LEARNING, EXECUTION, and BUSINESS OUTCOMES — not software activity.
// Five sections: Acquisition, Outreach, Discovery, Commercial, Intelligence
// Quality. Everything is computed from the repository; nothing is invented. When a
// requested metric has no data source yet it is returned as an
// `instrumentationPending` note rather than a fabricated number, so the operator
// sees exactly what is measured before the first real outreach.
// ─────────────────────────────────────────────────────────────────────────────
import {
  listLeads,
  allPlans,
  allSteps,
  allMeetings,
  allProposals,
  allOutreach,
  allVideos,
  allDeliverables,
  listSuppressions,
  allFeedback,
  allBusinessIntelligence,
  allEmailSends,
  allInbound,
  allShares,
  listProspectingRuns,
} from "@/lib/repo";
import { isInternalLead } from "@/lib/operators/assignment";
import { levelOrdinal } from "@/lib/intelligence";
import { estimateRelationshipValue } from "@/lib/pricing";
import { categoryPerformance } from "@/lib/analytics";
import { commsMetrics, type CommsMetrics } from "@/lib/comms/monitoring";
import { distribution, avg, pct } from "./types";
import type { InboundMessage, Lead } from "@/lib/types";

// Reply-sentiment mapping over the fixed classifier vocabulary (see comms/reply.ts).
// Out Of Office / Bounce are not human sentiment and are excluded from replies.
const POSITIVE = new Set(["Interested", "Meeting Requested"]);
const NEGATIVE = new Set(["Already Working With Someone", "Unsubscribe"]);
const NON_HUMAN = new Set(["Out Of Office", "Bounce"]);
function replySentiment(m: InboundMessage): "positive" | "neutral" | "negative" | "none" {
  const c = m.classification ?? "";
  if (NON_HUMAN.has(c)) return "none";
  if (POSITIVE.has(c)) return "positive";
  if (NEGATIVE.has(c)) return "negative";
  return "neutral"; // Question, Not Now, Wrong Contact, Unknown
}

export interface AcquisitionMetrics {
  discovered: number;
  analyzed: number;
  approved: number;
  rejected: number;
  rejectionReasons: [string, number][];
  avgImprovementPotential: number | null; // 0..100
  avgTechnologyMaturity: number | null; // 1..5 (ordinal average)
  avgEvidenceConfidence: number | null; // 0..100
  leadSourceDistribution: [string, number][];
  avgEnrichmentSeconds: number | null; // proxy: average prospecting-run duration
  providerContribution: [string, number][]; // provider → % of analyzed businesses it contributed to
  biCount: number;
}

export interface OutreachMetrics {
  prepared: number;
  approved: number;
  sent: number;
  snapshotsSent: number;
  videosSent: number;
  emailOpens: number;
  snapshotViews: number; // concept-preview share views (only view-tracked artifact)
  videoViews: number | null; // not instrumented (videos are hosted externally)
  positiveReplies: number;
  neutralReplies: number;
  negativeReplies: number;
  noResponse: number;
  bounces: number;
  suppressions: number;
  unsubscribes: number;
  followUpCompletion: number; // % of scheduled steps that have sent
  avgResponseMinutes: number | null;
  deliverability: CommsMetrics["rates"];
}

export interface DiscoveryMetrics {
  callsBooked: number;
  callsCompleted: number;
  avgCallDurationMinutes: number | null; // not instrumented
  confirmedFrictionPoints: number | null; // not instrumented (captured at discovery)
  avgConfirmedOpportunities: number | null; // not instrumented
  avgDiscoveryConfidenceIncrease: number | null; // not instrumented
  evolutionPlansCreated: number;
  operatorNotesCompleted: number;
}

export interface CommercialMetrics {
  focusedImprovements: number;
  phasedModernizations: number;
  technologyPartnerships: number;
  proposalsDelivered: number;
  contractsSigned: number;
  revenueWon: number;
  monthlyRecurringRevenue: number | null; // not instrumented (billing cadence not stored)
  avgFirstEngagementValue: number | null; // projected entry value
  avgProjectedRelationshipValue: number | null; // confidence-adjusted 12-month
  expansionOpportunities: number;
}

export interface IndustryPerfRow {
  group: string;
  contacted: number;
  replies: number;
  meetings: number;
  won: number;
  sufficient: boolean;
}

export interface IntelligenceQualityMetrics {
  mostCommonFriction: [string, number][];
  mostCommonOpportunities: [string, number][];
  industryPerformance: IndustryPerfRow[];
  /** Metrics that require captured discovery/outcome data — dark until real outreach. */
  instrumentationPending: string[];
}

export interface LaunchMetrics {
  generatedAt: string;
  acquisition: AcquisitionMetrics;
  outreach: OutreachMetrics;
  discovery: DiscoveryMetrics;
  commercial: CommercialMetrics;
  intelligenceQuality: IntelligenceQualityMetrics;
}

export async function launchMetrics(now: Date = new Date()): Promise<LaunchMetrics> {
  const [
    leads, plans, steps, meetings, proposals, outreach, videos, deliverables,
    suppressions, feedback, bi, emailSends, inbound, shares, runs, comms,
  ] = await Promise.all([
    listLeads(), allPlans(), allSteps(), allMeetings(), allProposals(), allOutreach(),
    allVideos(), allDeliverables(), listSuppressions(), allFeedback(), allBusinessIntelligence(),
    allEmailSends(), allInbound(), allShares(), listProspectingRuns(50), commsMetrics({ now }),
  ]);

  // Real acquisition performance only — internal/test rows never inflate the launch dashboard.
  const internalLeadIds = new Set(leads.filter(isInternalLead).map((l) => l.id));
  return {
    generatedAt: now.toISOString(),
    acquisition: acquisitionSection(leads, plans, bi, runs),
    outreach: outreachSection(steps, outreach, emailSends, inbound, deliverables, videos, shares, suppressions, comms, internalLeadIds),
    discovery: discoverySection(meetings, bi),
    commercial: commercialSection(leads, proposals),
    intelligenceQuality: intelligenceQualitySection(leads, bi, outreach, meetings, proposals),
  };
}

// ── Acquisition ──────────────────────────────────────────────────────────────
function acquisitionSection(
  leads: Lead[],
  plans: Awaited<ReturnType<typeof allPlans>>,
  bi: Awaited<ReturnType<typeof allBusinessIntelligence>>,
  runs: Awaited<ReturnType<typeof listProspectingRuns>>,
): AcquisitionMetrics {
  const analyzed = leads.filter((l) => l.scoreBreakdown != null).length;

  const approvedLeadIds = new Set(plans.filter((p) => p.approvalStatus === "approved").map((p) => p.leadId));
  const rejectedLeadIds = new Set(plans.filter((p) => p.approvalStatus === "rejected").map((p) => p.leadId));
  for (const l of leads) if (l.pipelineStage === "Disqualified") rejectedLeadIds.add(l.id);

  // Rejection reasons — honest aggregation from whatever recorded them.
  const reasons: string[] = [];
  for (const p of plans.filter((p) => p.approvalStatus === "rejected")) {
    reasons.push(p.stopReason || p.pauseReason || "Rejected in review");
  }
  for (const l of leads) {
    if (l.pipelineStage === "Disqualified") reasons.push(l.note?.trim() || "Disqualified");
    else if (l.acquisitionStrategy === "Do Not Contact") reasons.push(l.acquisitionReason?.trim() || "Do Not Contact");
  }

  const completedRuns = runs.filter((r) => r.completedAt);
  const durations = completedRuns.map((r) => (+new Date(r.completedAt!) - +new Date(r.startedAt)) / 1000).filter((s) => s >= 0);

  // Provider contribution — share of analyzed businesses each provider helped.
  const providerHits = new Map<string, number>();
  for (const row of bi) {
    for (const p of row.profile.providerCoverage?.contributing ?? []) providerHits.set(p, (providerHits.get(p) ?? 0) + 1);
  }
  const providerContribution: [string, number][] = bi.length
    ? [...providerHits.entries()].map(([k, n]) => [k, pct(n, bi.length)] as [string, number]).sort((a, b) => b[1] - a[1])
    : [];

  return {
    discovered: leads.length,
    analyzed,
    approved: approvedLeadIds.size,
    rejected: rejectedLeadIds.size,
    rejectionReasons: distribution(reasons, (r) => r),
    avgImprovementPotential: avg(bi.map((b) => b.improvementScore)),
    avgTechnologyMaturity: avg(bi.flatMap((b) => (b.profile.maturity ? [levelOrdinal(b.profile.maturity.overall)] : []))),
    avgEvidenceConfidence: avg(bi.map((b) => b.evidenceConfidence)),
    leadSourceDistribution: distribution(leads, (l) => l.source),
    avgEnrichmentSeconds: durations.length ? Math.round(avg(durations)!) : null,
    providerContribution,
    biCount: bi.length,
  };
}

// ── Outreach ─────────────────────────────────────────────────────────────────
function outreachSection(
  steps: Awaited<ReturnType<typeof allSteps>>,
  outreach: Awaited<ReturnType<typeof allOutreach>>,
  emailSends: Awaited<ReturnType<typeof allEmailSends>>,
  inbound: InboundMessage[],
  deliverables: Awaited<ReturnType<typeof allDeliverables>>,
  videos: Awaited<ReturnType<typeof allVideos>>,
  shares: Awaited<ReturnType<typeof allShares>>,
  suppressions: Awaited<ReturnType<typeof listSuppressions>>,
  comms: CommsMetrics,
  internalLeadIds: Set<string> = new Set(),
): OutreachMetrics {
  // Drop internal/test rows so this business dashboard reflects REAL outreach only. `comms` is
  // already real-only (computed in commsMetrics). Kept off the lead-linked inputs here.
  const notInternal = (leadId: string | null | undefined) => !(leadId && internalLeadIds.has(leadId));
  // The lead-linked activity inputs (sends, inbound replies, legacy outreach) drop internal/test
  // rows. Steps are plan-linked (no direct leadId) and only feed prepared/approved counts.
  outreach = outreach.filter((o) => notInternal(o.leadId));
  emailSends = emailSends.filter((s) => notInternal(s.leadId));
  inbound = inbound.filter((m) => notInternal(m.leadId));
  // The live send-ledger (emailSends) and the legacy outreach table are disjoint:
  // production writes only the ledger; seeded demos populate the legacy table.
  // Summing therefore reflects total activity without double-counting.
  const emailSteps = steps.filter((s) => s.channel === "email");
  const prepared = emailSteps.length + outreach.length;
  const approved =
    emailSteps.filter((s) => s.approvalStatus === "approved").length +
    outreach.filter((o) => o.status === "approved" || o.status === "sent").length;
  const emailSent = emailSends.filter((s) => s.sentAt).length;
  const legacySent = outreach.filter((o) => o.status === "sent").length;

  const human = inbound.filter((m) => !NON_HUMAN.has(m.classification ?? ""));
  const positive = human.filter((m) => replySentiment(m) === "positive").length;
  const negative = human.filter((m) => replySentiment(m) === "negative").length;
  const neutral = human.filter((m) => replySentiment(m) === "neutral").length;

  const bounces = emailSends.filter((s) => s.bouncedAt).length + inbound.filter((m) => m.classification === "Bounce").length;
  const unsubscribes =
    emailSends.filter((s) => s.unsubscribedAt).length +
    suppressions.filter((s) => /unsub|opt.?out/i.test(s.reason)).length;

  const contactedLeads = new Set<string>();
  for (const s of emailSends) if (s.sentAt && s.leadId) contactedLeads.add(s.leadId);
  for (const o of outreach) if (o.status === "sent") contactedLeads.add(o.leadId);
  const repliedLeads = new Set(human.map((m) => m.leadId));
  const noResponse = [...contactedLeads].filter((id) => !repliedLeads.has(id)).length;

  const scheduledSteps = emailSteps.filter((s) => s.scheduledAt).length;
  const sentSteps = emailSteps.filter((s) => s.sentAt).length;

  return {
    prepared,
    approved,
    sent: emailSent + legacySent,
    snapshotsSent: deliverables.filter((d) => d.status === "sent").length,
    videosSent: videos.filter((v) => v.status === "sent").length,
    emailOpens: emailSends.filter((s) => s.openedAt).length,
    snapshotViews: shares.reduce((sum, s) => sum + (s.viewCount ?? 0), 0),
    videoViews: null,
    positiveReplies: positive,
    neutralReplies: neutral,
    negativeReplies: negative,
    noResponse,
    bounces,
    suppressions: suppressions.length,
    unsubscribes,
    followUpCompletion: pct(sentSteps, scheduledSteps),
    avgResponseMinutes: comms.replies.averageReplyMinutes,
    deliverability: comms.rates,
  };
}

// ── Discovery ────────────────────────────────────────────────────────────────
function discoverySection(
  meetings: Awaited<ReturnType<typeof allMeetings>>,
  bi: Awaited<ReturnType<typeof allBusinessIntelligence>>,
): DiscoveryMetrics {
  return {
    callsBooked: meetings.length,
    callsCompleted: meetings.filter((m) => m.outcome !== "pending").length,
    avgCallDurationMinutes: null,
    confirmedFrictionPoints: null,
    avgConfirmedOpportunities: null,
    avgDiscoveryConfidenceIncrease: null,
    evolutionPlansCreated: bi.filter((b) => (b.profile.evolution?.opportunities?.length ?? 0) > 0).length,
    operatorNotesCompleted: meetings.filter((m) => (m.notes ?? "").trim().length > 0).length,
  };
}

// ── Commercial ───────────────────────────────────────────────────────────────
function commercialSection(
  leads: Lead[],
  proposals: Awaited<ReturnType<typeof allProposals>>,
): CommercialMetrics {
  // The engagement model the engine recommends as the entry point — its commercial
  // proposal for each analyzed business.
  const valued = leads.filter((l) => l.estimatedValueHigh != null || l.estimatedValueLow != null);
  const rv = valued.map((l) => estimateRelationshipValue(l));
  const byEntry = (key: string) => rv.filter((r) => r.recommendedEntry === key).length;

  const accepted = proposals.filter((p) => p.status === "accepted");
  return {
    focusedImprovements: byEntry("focused-improvement"),
    phasedModernizations: byEntry("phased-modernization"),
    technologyPartnerships: byEntry("ongoing-partnership"),
    proposalsDelivered: proposals.filter((p) => p.status !== "draft").length,
    contractsSigned: accepted.length,
    revenueWon: accepted.reduce((s, p) => s + (p.amount ?? 0), 0),
    monthlyRecurringRevenue: null,
    avgFirstEngagementValue: avg(rv.map((r) => r.entry)),
    avgProjectedRelationshipValue: avg(rv.map((r) => r.confidenceAdjustedTwelveMonth)),
    expansionOpportunities: rv.filter((r) => r.partnershipLikelihood >= 0.5).length,
  };
}

// ── Intelligence Quality ─────────────────────────────────────────────────────
function intelligenceQualitySection(
  leads: Lead[],
  bi: Awaited<ReturnType<typeof allBusinessIntelligence>>,
  outreach: Awaited<ReturnType<typeof allOutreach>>,
  meetings: Awaited<ReturnType<typeof allMeetings>>,
  proposals: Awaited<ReturnType<typeof allProposals>>,
): IntelligenceQualityMetrics {
  const friction = bi.flatMap((b) => b.profile.frictionDomains ?? []);
  const opportunities = bi.flatMap((b) => (b.profile.evolution?.opportunities ?? []).map((o) => String(o.domain)));

  const catPerf = categoryPerformance(leads, outreach as any, meetings, proposals);
  const industryPerformance: IndustryPerfRow[] = catPerf.map((r) => ({
    group: r.group, contacted: r.contacted, replies: r.replies, meetings: r.meetings, won: r.won, sufficient: r.sufficient,
  }));

  // These require captured OUTCOMES from real discovery calls / closed engagements.
  // Before the first campaign there is nothing to measure — we say so rather than
  // invent an accuracy number.
  const instrumentationPending = [
    "Prediction accuracy (needs confirmed-vs-hypothesized friction from discovery)",
    "False positives (needs discovery disconfirmation capture)",
    "Missed opportunities (needs post-engagement review)",
    "Recommendation acceptance rate (needs client accept/decline capture)",
    "Discovery validation rate (needs per-call confirmation capture)",
    "Confidence calibration (needs predicted-vs-actual outcome pairs)",
    "Most successful outreach angles (needs angle tagging + reply attribution)",
    "Learning trends over time (accumulates once outcomes are captured)",
  ];

  return {
    mostCommonFriction: distribution(friction, (f) => f),
    mostCommonOpportunities: distribution(opportunities, (o) => o),
    industryPerformance,
    instrumentationPending,
  };
}

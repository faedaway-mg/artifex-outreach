// ─────────────────────────────────────────────────────────────────────────────
// First 100 Businesses mode (Phase 5).
//
// A campaign-scoped lens over the earliest cohort of businesses, built to LEARN as
// fast as possible: the funnel for the cohort plus the qualitative signal
// (objections, friction, decline reasons, operator observations). The cohort is the
// first N businesses by discovery order, so the view stays stable as new leads
// arrive later.
//
// Signals that require capture we don't yet have (true "requested improvements",
// recommendation accuracy) are reported as proxies or as pending — never invented.
// ─────────────────────────────────────────────────────────────────────────────
import {
  listLeads, allBusinessIntelligence, allEmailSends, allInbound, allMeetings, allProposals, allPlans,
} from "@/lib/repo";
import { distribution, pct } from "./types";
import type { InboundMessage } from "@/lib/types";

const OBJECTION_LABEL: Record<string, string> = {
  "Already Working With Someone": "Already has a provider",
  "Not Now": "Timing / not right now",
  Question: "Wants pricing / more info",
  "Wrong Contact": "Reached the wrong person",
  Unsubscribe: "Asked to opt out",
};

export interface FirstHundred {
  target: number;
  cohortSize: number;
  analyzed: number;
  contacted: number;
  replies: number;
  discoveryCalls: number;
  projectsWon: number;
  progressPct: number; // contacted / target
  declineReasons: [string, number][];
  commonFriction: [string, number][];
  commonObjections: [string, number][];
  requestedImprovements: [string, number][]; // proxy: opportunity domains surfaced (see note)
  recommendationAccuracy: number | null; // pending outcome capture
  operatorObservations: string[];
  unexpectedFeedback: string[]; // inbound classified Unknown = didn't fit the model
}

export async function firstHundred(target = 100): Promise<FirstHundred> {
  const [leads, bi, sends, inbound, meetings, proposals, plans] = await Promise.all([
    listLeads(), allBusinessIntelligence(), allEmailSends(), allInbound(), allMeetings(), allProposals(), allPlans(),
  ]);

  // Cohort = earliest-discovered businesses.
  const cohort = [...leads].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)).slice(0, target);
  const ids = new Set(cohort.map((l) => l.id));
  const inCohort = <T extends { leadId?: string | null }>(x: T) => !!x.leadId && ids.has(x.leadId);

  const cohortInbound = inbound.filter(inCohort);
  const human = cohortInbound.filter((m) => !["Out Of Office", "Bounce"].includes(m.classification ?? ""));
  const contactedIds = new Set<string>();
  for (const s of sends) if (s.sentAt && s.leadId && ids.has(s.leadId)) contactedIds.add(s.leadId);

  const declineReasons: string[] = [];
  for (const l of cohort) {
    if (l.pipelineStage === "Lost" || l.pipelineStage === "Disqualified") declineReasons.push(l.note?.trim() || l.pipelineStage);
  }
  for (const p of plans.filter((p) => inCohort(p) && p.approvalStatus === "rejected")) declineReasons.push(p.stopReason || "Rejected in review");

  const biCohort = bi.filter((b) => ids.has(b.leadId));
  const commonFriction = distribution(biCohort.flatMap((b) => b.profile.frictionDomains ?? []), (f) => f);
  const requestedImprovements = distribution(
    biCohort.flatMap((b) => (b.profile.evolution?.opportunities ?? []).map((o) => String(o.domain))),
    (d) => d,
  );

  const objections = human
    .map((m) => OBJECTION_LABEL[m.classification ?? ""])
    .filter((x): x is string => !!x);

  const observations: string[] = [];
  for (const l of cohort) if ((l.note ?? "").trim()) observations.push(`${l.businessName}: ${l.note!.trim()}`);
  for (const m of meetings.filter(inCohort)) if ((m.notes ?? "").trim()) observations.push(`Meeting: ${m.notes!.trim()}`);

  const unexpected = human.filter((m) => (m.classification ?? "Unknown") === "Unknown").map((m) => `${m.fromAddr}: ${m.subject}`.trim());

  return {
    target,
    cohortSize: cohort.length,
    analyzed: cohort.filter((l) => l.scoreBreakdown != null).length,
    contacted: contactedIds.size,
    replies: human.length,
    discoveryCalls: meetings.filter(inCohort).length,
    projectsWon: cohort.filter((l) => l.pipelineStage === "Won").length,
    progressPct: pct(contactedIds.size, target),
    declineReasons: distribution(declineReasons, (r) => r),
    commonFriction,
    commonObjections: distribution(objections, (o) => o),
    requestedImprovements,
    recommendationAccuracy: null,
    operatorObservations: observations.slice(0, 25),
    unexpectedFeedback: unexpected.slice(0, 25),
  };
}

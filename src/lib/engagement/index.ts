// ─────────────────────────────────────────────────────────────────────────────
// Engagement Integration — the workflow layer.
//
// Composes the permanent intelligence foundation into one continuous consulting
// workflow: a command center, a unified timeline, surfaced follow-ups, immutable
// baseline snapshots, and a portfolio read. No new inference — only cohesion.
// ─────────────────────────────────────────────────────────────────────────────
export * from "./types";
export { pendingWork } from "./follow-up";
export { engagementTimeline } from "./timeline";
export { buildCommandCenter, momentumOf } from "./command-center";
export { buildPortfolioRow } from "./portfolio";
export { composeSnapshot, beforeStateFromSnapshot, parseSnapshot } from "./snapshot";
export { buildConsultingDossier } from "./dossier";
export type { ConsultingDossier, DossierRecommendation, DossierMemory } from "./dossier";
export { buildLivingProposal } from "./proposal-doc";
export type { LivingProposal, ProposalRecommendation } from "./proposal-doc";

import type { Lead, Meeting, Proposal, Outreach, InboundMessage, RelationshipMemoryItem, RoadmapProgressItem, OutcomeReviewItem, EngagementSnapshotItem } from "../types";
import type { EngagementContext } from "./types";
import { buildReasoning } from "../reasoning";
import { buildExecutionPlan } from "../roadmap";

/** Assemble the shared engagement context from a lead's raw records. */
export function assembleEngagementContext(input: {
  lead: Lead;
  memory: RelationshipMemoryItem[];
  meetings: Meeting[];
  proposals: Proposal[];
  plans: { status: string }[];
  progress: RoadmapProgressItem[];
  reviews: OutcomeReviewItem[];
  outreach: Outreach[];
  inbound: InboundMessage[];
  snapshots: EngagementSnapshotItem[];
  now: number;
}): EngagementContext {
  const { lead, memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots, now } = input;
  const reasoning = buildReasoning(memory, {
    meetingsHeld: meetings.length,
    proposalsDiscussed: proposals.length,
    activePlans: plans.filter((p) => p.status === "active").length,
    acceptedProposals: proposals.filter((p) => (p as { status: string }).status === "accepted").length,
  }, now);
  const active = memory.filter((m) => m.status !== "Superseded" && m.status !== "Resolved");
  const plan = buildExecutionPlan({
    recommendations: reasoning.recommendations,
    progress,
    signals: {
      memories: active.length,
      categories: new Set(active.map((m) => m.category)).size,
      inferences: reasoning.inferences.length,
      meetingsHeld: meetings.length,
      proposalsDiscussed: proposals.length,
      acceptedProposals: proposals.filter((p) => (p as { status: string }).status === "accepted").length,
    },
  });
  return { lead, memory, reasoning, plan, reviews, progress, meetings, proposals, outreach, inbound, snapshots, now };
}

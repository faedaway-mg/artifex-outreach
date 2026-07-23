// ─────────────────────────────────────────────────────────────────────────────
// Engagement Integration — the layer that makes the Founder OS feel like ONE
// continuous consulting workflow instead of separate modules.
//
// Nothing new is inferred here. This layer composes the permanent intelligence
// foundation (Memory, Reasoning, Roadmap, Outcomes) into a single operating surface:
// what needs attention, one chronological timeline, and a portfolio read. Everything
// stays deterministic, explainable, and operator-controlled.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Meeting, Proposal, Outreach, InboundMessage, RelationshipMemoryItem, RoadmapProgressItem, OutcomeReviewItem, EngagementSnapshotItem } from "../types";
import type { RelationshipReasoning } from "../reasoning";
import type { ExecutionPlan, RoadmapItem, TransformationStage } from "../roadmap";

/** Everything one lead's engagement surfaces read from — assembled once per request. */
export interface EngagementContext {
  lead: Lead;
  memory: RelationshipMemoryItem[];
  reasoning: RelationshipReasoning;
  plan: ExecutionPlan;
  reviews: OutcomeReviewItem[];
  progress: RoadmapProgressItem[];
  meetings: Meeting[];
  proposals: Proposal[];
  outreach: Outreach[];
  inbound: InboundMessage[];
  snapshots: EngagementSnapshotItem[];
  now: number;
}

export type FollowUpKind = "outcome-review" | "measure" | "blocked" | "contradiction" | "discovery-gap" | "proposal-revision";

/** A piece of pending work, surfaced (never a reminder we created on our own). */
export interface FollowUpItem {
  id: string;
  kind: FollowUpKind;
  title: string;
  /** Why this needs attention. */
  why: string;
  /** The evidence behind it. */
  evidence: string;
  nextLabel: string;
  nextHref: string;
  severity: "high" | "medium" | "low";
}

export type TimelineSource = "meeting" | "memory" | "reasoning" | "roadmap" | "outcome" | "evolution" | "email" | "reply" | "proposal" | "snapshot";

/** One entry in the single chronological engagement story. */
export interface TimelineEntry {
  at: string;
  source: TimelineSource;
  title: string;
  detail?: string;
}

export interface CommandCenter {
  stage: TransformationStage | null;
  healthReached: number;
  healthTotal: number;
  momentum: { label: string; tone: string };
  priorities: RoadmapItem[];
  currentRecommendation: { title: string; reason: string } | null;
  currentImplementation: RoadmapItem[];
  blockers: RoadmapItem[];
  awaitingReviewCount: number;
  latestLearning: RelationshipMemoryItem[];
  recentComms: TimelineEntry[];
  upcomingFollowUp: Meeting | null;
  pending: FollowUpItem[];
  timeline: TimelineEntry[];
}

export interface PortfolioRow {
  leadId: string;
  businessName: string;
  stage: string;
  healthReached: number;
  healthTotal: number;
  implementedCount: number;
  recommendationCount: number;
  awaitingReviews: number;
  topOpportunity: string | null;
  momentum: string;
  needsFollowUp: number;
  recentWin: boolean;
  atRisk: boolean;
}

/** The frozen "before" state captured when a recommendation is committed to. */
export interface EngagementSnapshotPayload {
  capturedFor: string;
  trigger: string;
  memory: Array<{ id: string; category: string; title: string; value: string; status: string }>;
  strategist: { narrativeOpening: string; inferences: Array<{ claim: string; confidence: string }> };
  roadmapPlacement: { phase: string; why: string } | null;
  businessNarrative: string;
  healthNarrative: string;
  proposalState: string;
  relationshipState: string;
}

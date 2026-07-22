// ─────────────────────────────────────────────────────────────────────────────
// Execution Intelligence — types for the adaptive consulting roadmap.
//
// The reasoning layer answers "what do we know?". This layer answers "what should
// happen next?". It sequences evidence-backed recommendations into a living roadmap,
// respecting dependencies and the operator-approved implementation journal. It never
// creates projects, invents urgency, or fabricates dependencies — every placement is
// explained and traces back to evidence.
// ─────────────────────────────────────────────────────────────────────────────
import type { RoadmapStatus } from "../types";
import type { ReasonedRecommendation, ConfidenceRead } from "../reasoning/types";

export const EXECUTION_PHASES = [
  "Immediate",
  "Near-term",
  "Long-term",
  "Future consideration",
  "Blocked",
  "Completed",
] as const;
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export type ImpactLevel = "High" | "Medium" | "Low";
export type EffortLevel = ReasonedRecommendation["effort"]; // Light | Moderate | Substantial

/** Why a placement is where it is — the operator can always read the reasoning. */
export interface Explainability {
  whyNow: string;
  whyNotEarlier: string;
  whatBlocks: string;
  whatIfWait: string;
}

export interface SuccessMetric {
  looksLike: string;
  measuredBy: string;
  reviewWhen: string;
}

export interface RoadmapItem {
  recommendationId: string;
  title: string;
  rationale: string;
  phase: ExecutionPhase;
  status: RoadmapStatus;
  impact: ImpactLevel;
  effort: EffortLevel;
  confidence: ConfidenceRead;
  /** One line: why this sits in this phase. */
  why: string;
  explain: Explainability;
  /** Recommendation ids that must complete first (and haven't). */
  blockedBy: string[];
  successMetric: SuccessMetric;
  evidenceMemoryIds: string[];
  quickWin: boolean;
}

/** A prerequisite relationship: `from` should complete before `to`. */
export interface DependencyEdge {
  from: string;
  to: string;
  reason: string;
}

/** One recommendation's place in the rollout order, with the operator-facing reason. */
export interface SequenceStep {
  recommendationId: string;
  title: string;
  order: number;
  reason: string;
}

export const TRANSFORMATION_STAGES = [
  "Discovery",
  "Understanding",
  "Proposal",
  "Implementation",
  "Optimization",
  "Ongoing Partnership",
] as const;
export type TransformationStageKey = (typeof TRANSFORMATION_STAGES)[number];

export interface TransformationStage {
  key: TransformationStageKey;
  reached: boolean;
  current: boolean;
  evidence: string;
}

export interface ExecutionPlan {
  items: RoadmapItem[];
  dependencies: DependencyEdge[];
  sequence: SequenceStep[];
  transformation: TransformationStage[];
  /** Completed / measured work — kept so we never re-recommend solved problems. */
  completed: RoadmapItem[];
}

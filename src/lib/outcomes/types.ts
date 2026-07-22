// ─────────────────────────────────────────────────────────────────────────────
// Outcomes Intelligence — types for the learning layer that closes the lifecycle.
//
// The system already understands businesses and recommends what to do. This layer
// answers "did it actually work?" — grounded only in operator observations and
// measurable evidence. Nothing is ever marked successful automatically, no success
// is fabricated, and every conclusion cites where it came from.
// ─────────────────────────────────────────────────────────────────────────────
import type { OutcomeReviewItem, OutcomeStatus } from "../types";

/** A before → implementation → observed → evidence read of one recommendation. */
export interface BeforeAfter {
  recommendationId: string;
  title: string;
  before: string;
  implementation: string;
  observed: string;
  evidenceSources: string[];
  status: OutcomeStatus;
}

export type EvolutionKind = "implemented" | "observed";

/** A real, recorded change in the business — never a guess. */
export interface EvolutionEvent {
  at: string;
  title: string;
  detail: string;
  kind: EvolutionKind;
  recommendationId: string;
  evidence: string;
}

export interface HealthNarrative {
  opening: string;
  points: string[];
  /** The reviews this narrative is drawn from — so it's always traceable. */
  fromReviewIds: string[];
}

/** Consulting effectiveness for one recommendation type. Counts, not grades. */
export interface EffectivenessRow {
  recommendationId: string;
  title: string;
  recommended: number;
  implemented: number;
  reviewed: number;
  supported: number;
  mixed: number;
  unsupported: number;
  insufficient: number;
}

/** A cross-engagement pattern — recorded ONLY after repeated supporting evidence. */
export interface KnowledgePattern {
  recommendationId: string;
  title: string;
  /** Distinct leads whose outcomes support this. Length ≥ 2 by construction. */
  supportingLeadIds: string[];
  supportedCount: number;
  mixedCount: number;
  summary: string;
}

/** An evidence-backed proposal line — only produced when a pattern supports it. */
export interface ProposalEvidenceLine {
  recommendationId: string;
  line: string;
  engagements: number;
}

export interface OutcomesDashboard {
  recentlyCompleted: BeforeAfter[];
  awaitingReview: BeforeAfter[];
  validated: BeforeAfter[];
  mixed: BeforeAfter[];
  needingFollowUp: BeforeAfter[];
}

export type { OutcomeReviewItem, OutcomeStatus };

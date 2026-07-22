// ─────────────────────────────────────────────────────────────────────────────
// Relationship Reasoning — shared types.
//
// A reasoning layer *above* Relationship Memory. Memory stores facts; reasoning
// connects them. Two rules are absolute:
//   1. Nothing is produced without evidence — every insight cites the memory ids
//      that support it, so the operator can always click backward to the source.
//   2. Confidence is measured, never invented (see confidence.ts).
// Everything here is deterministic and explainable. No prediction, no fabrication.
// ─────────────────────────────────────────────────────────────────────────────
import type { MemoryConfidence } from "../types";

/** A single, transparent reason the confidence read came out where it did. */
export interface ConfidenceFactor {
  label: string;
  detail: string;
}

/** A measured confidence — a label, a 0–100 score, and the factors behind it. */
export interface ConfidenceRead {
  label: MemoryConfidence;
  score: number;
  factors: ConfidenceFactor[];
}

export type InferenceKind = "operational" | "relationship" | "risk" | "opportunity";

/** A connected conclusion drawn across ≥2 memories. Always cites its evidence. */
export interface Inference {
  id: string;
  kind: InferenceKind;
  /** The conclusion, stated plainly and provisionally. */
  claim: string;
  /** One sentence: why these memories point here. */
  because: string;
  /** The memory ids this conclusion rests on. Never empty. */
  memoryIds: string[];
  confidence: ConfidenceRead;
}

/** A flagged conflict between two memories. Never auto-resolved. */
export interface Contradiction {
  id: string;
  topic: string;
  /** The two conflicting memory ids. */
  between: [string, string];
  explanation: string;
  /** What we ask the operator to decide — we never choose for them. */
  prompt: string;
}

export type NarrativeKey =
  | "Current State"
  | "Goals"
  | "Constraints"
  | "Systems"
  | "People"
  | "Risks"
  | "Opportunities"
  | "Unknowns";

/** One section of the living business narrative — prose grounded in memory. */
export interface NarrativeSection {
  key: NarrativeKey;
  prose: string;
  memoryIds: string[];
}

export interface BusinessNarrative {
  /** "Over the last three conversations we've learned that…" */
  opening: string;
  sections: NarrativeSection[];
}

/** A node in an opportunity chain. `observed` = a memory supports it directly;
 *  otherwise it is a projected consequence, clearly marked as such. */
export interface OppNode {
  label: string;
  observed: boolean;
  memoryIds: string[];
  inferenceId?: string;
}

/** A cause→effect chain the operator can read as a story, not a list. */
export interface OppChain {
  id: string;
  title: string;
  nodes: OppNode[];
  confidence: ConfidenceRead;
}

export interface HealthSignal {
  milestone: string;
  reached: boolean;
  /** Evidence in one sentence — never a bare score. */
  evidence: string;
  memoryIds: string[];
}

/** A recommendation that reasons — the shape a consultant's proposal carries. */
export interface ReasonedRecommendation {
  id: string;
  title: string;
  rationale: string;
  evidenceMemoryIds: string[];
  relatedInferenceIds: string[];
  observedImpact: string;
  suggestedOutcome: string;
  dependencies: string[];
  effort: "Light" | "Moderate" | "Substantial";
  confidence: ConfidenceRead;
}

/** A natural, memory-grounded line to open a follow-up with. */
export interface MemoryReference {
  sentence: string;
  memoryId: string;
}

/** The whole reasoning read for a lead — everything the strategist surface shows. */
export interface RelationshipReasoning {
  inferences: Inference[];
  narrative: BusinessNarrative;
  contradictions: Contradiction[];
  opportunityChains: OppChain[];
  health: HealthSignal[];
  recommendations: ReasonedRecommendation[];
  followUpReferences: MemoryReference[];
}

export const MEMORY_CONFIDENCE_UNKNOWN: MemoryConfidence = "Low";

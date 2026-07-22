// ─────────────────────────────────────────────────────────────────────────────
// Execution Intelligence — the aggregator.
//
// Turns evidence-backed recommendations + the operator-approved journal into a full
// execution plan: a phased roadmap (each placement explained), a dependency graph, a
// recommended rollout order, and the business's transformation stage. Completed work
// is carried separately so a solved problem is never recommended again.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReasonedRecommendation } from "../reasoning/types";
import type { RoadmapProgressItem, RoadmapStatus } from "../types";
import type { ExecutionPlan } from "./types";
import { buildDependencies } from "./dependencies";
import { buildRoadmap } from "./roadmap";
import { buildSequence } from "./sequencing";
import { buildTransformation, type TransformationSignals } from "./transformation";

export * from "./types";
export { buildDependencies, topologicalOrder, prerequisitesOf } from "./dependencies";
export { buildRoadmap } from "./roadmap";
export { buildSequence } from "./sequencing";
export { buildTransformation } from "./transformation";
export type { TransformationSignals } from "./transformation";

export interface ExecutionInputs {
  recommendations: ReasonedRecommendation[];
  progress: RoadmapProgressItem[];
  /** Signals for the transformation timeline (from memory, reasoning, meetings, plans). */
  signals: Omit<TransformationSignals, "approvedOrInProgress" | "completedOrMeasured" | "measured">;
}

const IN_PROGRESS: RoadmapStatus[] = ["Approved", "In Progress"];
const COMPLETED: RoadmapStatus[] = ["Completed", "Measured"];

export function buildExecutionPlan({ recommendations, progress, signals }: ExecutionInputs): ExecutionPlan {
  const progressMap = new Map<string, RoadmapStatus>(progress.map((p) => [p.recommendationId, p.status]));
  const edges = buildDependencies(recommendations);
  const all = buildRoadmap(recommendations, progressMap, edges);

  const completed = all.filter((i) => i.phase === "Completed");
  const active = all.filter((i) => i.phase !== "Completed");
  const sequence = buildSequence(active, recommendations, edges);

  const statuses = progress.map((p) => p.status);
  const transformation = buildTransformation({
    ...signals,
    approvedOrInProgress: statuses.filter((s) => IN_PROGRESS.includes(s)).length,
    completedOrMeasured: statuses.filter((s) => COMPLETED.includes(s)).length,
    measured: statuses.filter((s) => s === "Measured").length,
  });

  return { items: active, completed, dependencies: edges, sequence, transformation };
}

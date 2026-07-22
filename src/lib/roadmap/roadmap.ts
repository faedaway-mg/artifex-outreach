// ─────────────────────────────────────────────────────────────────────────────
// The adaptive roadmap — place every recommendation, and explain why.
//
// Placement respects three things: the operator-approved journal status, the
// dependency graph (a recommendation whose prerequisite isn't done is Blocked, not
// pretend-ready), and an evidence-grounded read of impact / effort / confidence.
// Every item answers: why now, why not earlier, what blocks it, what happens if we
// wait. Completed work is carried, never re-recommended.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReasonedRecommendation } from "../reasoning/types";
import type { RoadmapStatus } from "../types";
import type { RoadmapItem, ExecutionPhase, ImpactLevel } from "./types";
import type { DependencyEdge } from "./types";
import { prerequisitesOf } from "./dependencies";
import { impactFor, metricFor } from "./meta";

const DONE = (s: RoadmapStatus) => s === "Completed" || s === "Measured";
const IMPACT_RANK: Record<ImpactLevel, number> = { High: 3, Medium: 2, Low: 1 };

function titleFor(recs: Map<string, ReasonedRecommendation>, id: string): string {
  return recs.get(id)?.title ?? id;
}

export function buildRoadmap(
  recommendations: ReasonedRecommendation[],
  progress: Map<string, RoadmapStatus>,
  edges: DependencyEdge[],
): RoadmapItem[] {
  const byId = new Map(recommendations.map((r) => [r.id, r]));

  return recommendations.map((rec) => {
    const status: RoadmapStatus = progress.get(rec.id) ?? "Recommended";
    const impact = impactFor(rec.id);
    const conf = rec.confidence.label;

    const prereqs = prerequisitesOf(rec.id, edges);
    const blockedBy = prereqs.filter((p) => !DONE(progress.get(p) ?? "Recommended"));

    // ── Phase ────────────────────────────────────────────────────────────────
    let phase: ExecutionPhase;
    if (DONE(status)) phase = "Completed";
    else if (status === "In Progress" || status === "Approved") phase = "Immediate";
    else if (blockedBy.length > 0) phase = "Blocked";
    else if (conf === "High" && rec.effort !== "Substantial" && IMPACT_RANK[impact] >= 2) phase = "Immediate";
    else if (conf === "High" || conf === "Medium") phase = "Near-term";
    else if (IMPACT_RANK[impact] >= 3) phase = "Long-term";
    else phase = "Future consideration";

    const quickWin = phase !== "Blocked" && !DONE(status) && rec.effort === "Light" && conf === "High" && IMPACT_RANK[impact] >= 2;

    // ── The one-line reason ────────────────────────────────────────────────────
    const blockerTitles = blockedBy.map((b) => titleFor(byId, b));
    const why =
      phase === "Completed" ? `Marked ${status.toLowerCase()} — carried so we don't recommend it again.`
      : phase === "Immediate" ? (status === "In Progress" ? "Underway now." : status === "Approved" ? "Approved and ready to start." : `${conf} confidence and ${rec.effort.toLowerCase()} effort — worth doing first.`)
      : phase === "Blocked" ? `Waiting on ${blockerTitles.join(" and ")}.`
      : phase === "Near-term" ? (rec.effort === "Substantial" ? "Real value, but heavier — plan it, don't rush it." : "Solid evidence; sequence it just behind the quick wins.")
      : phase === "Long-term" ? "Promising, but the evidence isn't strong enough to lead with."
      : "Worth keeping in view; not enough yet to act on.";

    // ── Explainability ─────────────────────────────────────────────────────────
    const explain = {
      whyNow:
        phase === "Immediate" ? `The evidence is ${conf.toLowerCase()}, the effort is ${rec.effort.toLowerCase()}, and nothing has to happen before it.`
        : phase === "Completed" ? "It's already been carried through the journal to completion."
        : "It's not the thing to do right now — see below.",
      whyNotEarlier:
        blockedBy.length > 0 ? `It depends on ${blockerTitles.join(" and ")}, which ${blockedBy.length === 1 ? "isn't" : "aren't"} done yet.`
        : conf === "Low" ? "We don't yet have enough confirmed evidence to put weight on it."
        : rec.effort === "Substantial" ? "It's substantial enough that rushing it ahead of quicker wins would cost more than it returns."
        : "Nothing holds it back — it's simply sequenced against higher-leverage work.",
      whatBlocks: blockedBy.length > 0 ? `${blockerTitles.join(", ")}.` : "Nothing — it's clear to proceed when you choose.",
      whatIfWait:
        impact === "High" ? "The friction it addresses keeps costing them until it's handled."
        : impact === "Medium" ? "Little is lost by waiting, but the gain waits too."
        : "Waiting costs almost nothing here.",
    };

    return {
      recommendationId: rec.id,
      title: rec.title,
      rationale: rec.rationale,
      phase,
      status,
      impact,
      effort: rec.effort,
      confidence: rec.confidence,
      why,
      explain,
      blockedBy,
      successMetric: metricFor(rec.id),
      evidenceMemoryIds: rec.evidenceMemoryIds,
      quickWin,
    };
  });
}

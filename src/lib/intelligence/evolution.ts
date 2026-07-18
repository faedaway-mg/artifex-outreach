// ─────────────────────────────────────────────────────────────────────────────
// Business Evolution Engine.
//
// Artifex thinks beyond today's problem. Given where a business is (maturity) and
// how its friction connects (opportunity graph), this projects the likely arc of
// improvement — immediate, near-term, and future — with dependencies and a
// recommended sequence. The purpose is helping clients make better LONG-TERM
// technology decisions, not prediction for its own sake.
// ─────────────────────────────────────────────────────────────────────────────
import type { OpportunityGraph } from "./opportunity-graph";
import type { MaturityAssessment } from "./maturity";
import { TAXONOMY, type FrictionDomain } from "./friction-taxonomy";
import type { EngagementModelKey } from "../pricing";

export const HORIZONS = ["immediate", "near-term", "future"] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface EvolutionOpportunity {
  id: string;
  title: string;
  horizon: Horizon;
  domain: FrictionDomain | "cross-cutting";
  rationale: string;
  dependsOn: string[]; // ids of opportunities that should come first
  suggestedEngagement: EngagementModelKey;
}

export interface EvolutionPlan {
  opportunities: EvolutionOpportunity[];
  /** Ordered opportunity ids respecting dependencies + horizon. */
  recommendedSequence: string[];
  narrative: string;
}

export interface EvolutionInputs {
  graph: OpportunityGraph;
  maturity: MaturityAssessment;
  locationsCount: number;
  /** Whether the business shows expansion / high-volume signals. */
  growthSignal: boolean;
}

export function projectEvolution(input: EvolutionInputs): EvolutionPlan {
  const ops: EvolutionOpportunity[] = [];

  // 1) IMMEDIATE — the highest-leverage intervention from the graph.
  const hl = input.graph.highLeverage;
  if (hl) {
    ops.push({
      id: "op-immediate",
      title: TAXONOMY[hl.domain].implementationApproaches[0] ?? `Improve ${hl.domain}`,
      horizon: "immediate",
      domain: hl.domain,
      rationale: hl.rationale,
      dependsOn: [],
      suggestedEngagement: "focused-improvement",
    });
  }

  // 2) NEAR-TERM — relieve the connected downstream effects once the root is fixed.
  const downstream = (hl?.resolves ?? []).filter((d) => d !== hl?.domain).slice(0, 3);
  downstream.forEach((domain, i) => {
    ops.push({
      id: `op-near-${i}`,
      title: TAXONOMY[domain].implementationApproaches[0] ?? `Improve ${domain}`,
      horizon: "near-term",
      domain,
      rationale: `Follows naturally once ${hl?.domain.toLowerCase() ?? "the root issue"} is addressed: ${TAXONOMY[domain].description}`,
      dependsOn: hl ? ["op-immediate"] : [],
      suggestedEngagement: "phased-modernization",
    });
  });

  // 3) FUTURE — growth/scalability/innovation the business will grow into.
  if (input.growthSignal || input.locationsCount > 1) {
    ops.push({
      id: "op-future-growth",
      title: input.locationsCount > 1 ? "Multi-location coordination + standardized playbooks" : "Sequenced modernization for growth",
      horizon: "future",
      domain: "Growth Readiness",
      rationale: input.locationsCount > 1 ? "Multiple locations will reward standardized, coordinated systems." : "As volume rises, owner-dependent processes become the bottleneck.",
      dependsOn: downstream.length ? ["op-near-0"] : hl ? ["op-immediate"] : [],
      suggestedEngagement: "ongoing-partnership",
    });
  }
  ops.push({
    id: "op-future-innovation",
    title: "Explore a proprietary tool or product idea",
    horizon: "future",
    domain: "Innovation Opportunity",
    rationale: "Once operations are solid, latent product ideas become worth prototyping — discovered in conversation.",
    dependsOn: [],
    suggestedEngagement: "focused-improvement",
  });

  const recommendedSequence = topoOrder(ops);
  return { opportunities: ops, recommendedSequence, narrative: buildNarrative(ops) };
}

function topoOrder(ops: EvolutionOpportunity[]): string[] {
  const horizonRank: Record<Horizon, number> = { immediate: 0, "near-term": 1, future: 2 };
  const byId = new Map(ops.map((o) => [o.id, o]));
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (ordered.includes(id) || visiting.has(id)) return;
    visiting.add(id);
    const op = byId.get(id);
    if (op) for (const dep of op.dependsOn) if (byId.has(dep)) visit(dep);
    visiting.delete(id);
    if (!ordered.includes(id)) ordered.push(id);
  };
  [...ops].sort((a, b) => horizonRank[a.horizon] - horizonRank[b.horizon]).forEach((o) => visit(o.id));
  return ordered;
}

function buildNarrative(ops: EvolutionOpportunity[]): string {
  const now = ops.filter((o) => o.horizon === "immediate").map((o) => o.title);
  const next = ops.filter((o) => o.horizon === "near-term").map((o) => o.title);
  const later = ops.filter((o) => o.horizon === "future").map((o) => o.title);
  return [
    now.length ? `Start with: ${now.join("; ")}.` : "",
    next.length ? `Then, as that pays off: ${next.join("; ")}.` : "",
    later.length ? `Over time: ${later.join("; ")}.` : "",
    "Each step is optional and sequenced so the business only takes on what the previous step justifies.",
  ]
    .filter(Boolean)
    .join(" ");
}

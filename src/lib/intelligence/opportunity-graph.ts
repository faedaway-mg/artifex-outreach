// ─────────────────────────────────────────────────────────────────────────────
// Opportunity Graph — friction items are not independent problems, they are a
// connected operational story. This engine wires observations into cause→effect
// chains, finds root causes and downstream effects, and identifies the single
// highest-leverage intervention: the smallest improvement that resolves the most.
//
//   Confusing journey → low conversion → manual follow-up → lost visibility →
//   poor reporting → growth bottleneck
//
// The goal is ONE well-chosen recommendation, not a disconnected project list.
// ─────────────────────────────────────────────────────────────────────────────
import type { FrictionDomain } from "./friction-taxonomy";
import { TAXONOMY } from "./friction-taxonomy";

export type EdgeRelation = "leadsTo" | "blocks";

export interface OpportunityNode {
  domain: FrictionDomain;
  label: string;
  /** True if directly observed in evidence; false if implied by the causal model. */
  observed: boolean;
  priority: number; // 1..5 (from taxonomy, adjustable)
  confidence: string; // Verified | Likely | Unknown
}

export interface OpportunityEdge {
  from: FrictionDomain;
  to: FrictionDomain;
  relation: EdgeRelation;
  rationale: string;
}

export interface OpportunityGraph {
  nodes: OpportunityNode[];
  edges: OpportunityEdge[];
  rootCauses: FrictionDomain[];
  downstreamEffects: FrictionDomain[];
  /** The smallest-fix / largest-effect recommendation. */
  highLeverage: {
    domain: FrictionDomain;
    resolves: FrictionDomain[];
    leverageScore: number;
    rationale: string;
  } | null;
  /** The connected narrative, root → effect, in human language. */
  story: string;
}

// Canonical causal model between friction domains. cause → effect.
const CAUSAL_EDGES: Array<[FrictionDomain, FrictionDomain, EdgeRelation, string]> = [
  ["Customer Journey", "Customer Acquisition", "leadsTo", "A confusing journey suppresses inquiry conversion."],
  ["Customer Acquisition", "Sales Process", "leadsTo", "Fewer, lower-quality inquiries strain the sales process."],
  ["Customer Acquisition", "Customer Communication", "leadsTo", "Every inquiry that does convert must be chased manually."],
  ["Scheduling", "Customer Communication", "leadsTo", "Manual scheduling multiplies back-and-forth communication."],
  ["Customer Communication", "Information Visibility", "leadsTo", "Manual follow-up leaves no shared record of customer activity."],
  ["Data Flow", "Information Visibility", "leadsTo", "Disconnected tools scatter information."],
  ["Information Visibility", "Reporting", "leadsTo", "Without a source of truth, reporting is manual and late."],
  ["Reporting", "Decision Making", "leadsTo", "Poor reporting slows and weakens decisions."],
  ["Operations", "Scalability", "leadsTo", "Manual operations don't repeat cleanly as the business grows."],
  ["Technology Integration", "Data Flow", "leadsTo", "Unintegrated tools force manual data movement."],
  ["Automation", "Operations", "blocks", "Missing automation keeps operational work manual."],
  ["Decision Making", "Growth Readiness", "leadsTo", "Slow decisions cap how confidently the business can grow."],
  ["Scalability", "Growth Readiness", "leadsTo", "Processes that don't scale become the growth bottleneck."],
  ["Internal Workflow", "Operations", "leadsTo", "Unclear handoffs create operational drag."],
  ["Customer Experience", "Customer Acquisition", "leadsTo", "An inconsistent experience erodes conversion and repeat business."],
];

export interface ObservedFriction {
  domain: FrictionDomain;
  label: string;
  confidence: string;
  priority?: number;
}

export function buildOpportunityGraph(observed: ObservedFriction[]): OpportunityGraph {
  const observedDomains = new Set(observed.map((o) => o.domain));

  // Include observed nodes + any domain reachable downstream from them, so the
  // story shows where the friction ultimately leads (implied nodes flagged).
  const included = new Set<FrictionDomain>(observedDomains);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [from, to] of CAUSAL_EDGES) {
      if (included.has(from) && !included.has(to)) {
        included.add(to);
        grew = true;
      }
    }
  }

  const nodes: OpportunityNode[] = Array.from(included).map((domain) => {
    const obs = observed.find((o) => o.domain === domain);
    return {
      domain,
      label: obs?.label ?? TAXONOMY[domain].description,
      observed: observedDomains.has(domain),
      priority: obs?.priority ?? TAXONOMY[domain].basePriority,
      confidence: obs?.confidence ?? "Unknown",
    };
  });

  const edges = CAUSAL_EDGES.filter(([from, to]) => included.has(from) && included.has(to)).map(
    ([from, to, relation, rationale]) => ({ from, to, relation, rationale }),
  );

  // Root causes: included nodes with no incoming edge from another included node.
  const hasIncoming = new Set(edges.map((e) => e.to));
  const rootCauses = nodes.filter((n) => !hasIncoming.has(n.domain)).map((n) => n.domain);

  // Downstream effects: nodes that are implied (not observed) OR terminal.
  const hasOutgoing = new Set(edges.map((e) => e.from));
  const downstreamEffects = nodes.filter((n) => !hasOutgoing.has(n.domain)).map((n) => n.domain);

  const highLeverage = computeHighLeverage(nodes, edges, observedDomains);
  const story = buildStory(rootCauses, edges);

  return { nodes, edges, rootCauses, downstreamEffects, highLeverage, story };
}

function reachableFrom(start: FrictionDomain, edges: OpportunityEdge[]): Set<FrictionDomain> {
  const out = new Set<FrictionDomain>();
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.from === cur && !out.has(e.to)) {
        out.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return out;
}

function computeHighLeverage(
  nodes: OpportunityNode[],
  edges: OpportunityEdge[],
  observedDomains: Set<FrictionDomain>,
): OpportunityGraph["highLeverage"] {
  // Prefer an OBSERVED node (real, actionable now) that resolves the largest
  // weighted downstream set. Fixing a root cause ripples farthest.
  const candidates = nodes.filter((n) => n.observed);
  const pool = candidates.length ? candidates : nodes;
  let best: OpportunityGraph["highLeverage"] = null;
  for (const n of pool) {
    const downstream = reachableFrom(n.domain, edges);
    const weighted = Array.from(downstream).reduce((s, d) => s + (TAXONOMY[d].basePriority ?? 3), 0);
    const leverageScore = weighted + n.priority + (observedDomains.has(n.domain) ? 2 : 0);
    if (!best || leverageScore > best.leverageScore) {
      best = {
        domain: n.domain,
        resolves: Array.from(downstream),
        leverageScore,
        rationale: downstream.size
          ? `Improving ${n.domain.toLowerCase()} is the smallest change that relieves ${downstream.size} downstream issue(s): ${Array.from(downstream).join(", ")}.`
          : `${n.domain} is the most self-contained high-priority fix.`,
      };
    }
  }
  return best;
}

function buildStory(rootCauses: FrictionDomain[], edges: OpportunityEdge[]): string {
  if (!rootCauses.length) return "No connected friction story could be assembled from current evidence.";
  const root = rootCauses[0];
  const chain: string[] = [root];
  let cur = root;
  const seen = new Set<FrictionDomain>([root]);
  // Walk one representative longest-ish path for a readable narrative.
  for (let i = 0; i < 8; i++) {
    const next = edges.find((e) => e.from === cur && !seen.has(e.to));
    if (!next) break;
    chain.push(next.to);
    seen.add(next.to);
    cur = next.to;
  }
  return chain.join(" → ");
}

// ─────────────────────────────────────────────────────────────────────────────
// The opportunity graph — chains, not a list of disconnected issues.
//
// A recognised root cause is followed through its likely consequences to the point
// where it touches the business. The root node is grounded in evidence; the nodes
// downstream are marked as projected consequences, never dressed up as observed
// fact. The operator sees the story ("manual scheduling → bottleneck → missed calls
// → lost appointments → revenue"), and can click back to the memories at the root.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem } from "../types";
import type { OppChain, OppNode, Inference } from "./types";
import { scoreConfidence, isActive } from "./confidence";

const text = (m: RelationshipMemoryItem) => `${m.title} ${m.value} ${m.supportingContext ?? ""}`.toLowerCase();

/** A chain template: a root inference id → the consequences that follow from it. */
const TEMPLATES: Array<{ rootInference: string; title: string; consequences: string[] }> = [
  {
    rootInference: "manual-scheduling",
    title: "Manual scheduling → revenue at risk",
    consequences: ["The front desk becomes a bottleneck at busy times", "Calls get missed when the desk is buried", "Missed calls quietly become lost appointments", "Each lost appointment is revenue that never books"],
  },
  {
    rootInference: "capacity-bound-growth",
    title: "Capacity ceiling → growth stalls",
    consequences: ["The team absorbs more than it comfortably can", "Service quality gets harder to hold steady", "Growth plans stall until throughput improves"],
  },
];

export function buildOpportunityGraph(memories: RelationshipMemoryItem[], inferences: Inference[], now: number): OppChain[] {
  const active = memories.filter(isActive);
  const byId = new Map(inferences.map((i) => [i.id, i]));
  const chains: OppChain[] = [];

  for (const t of TEMPLATES) {
    const root = byId.get(t.rootInference);
    if (!root) continue; // only build a chain we have grounded evidence to start

    const rootNode: OppNode = { label: root.claim.replace(/\.$/, ""), observed: true, memoryIds: root.memoryIds, inferenceId: root.id };

    // A downstream node is "observed" only if a standing memory actually mentions it.
    const consequenceNodes: OppNode[] = t.consequences.map((label) => {
      const kw = label.toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 4);
      const supporting = active.filter((m) => kw.some((k) => text(m).includes(k)));
      return { label, observed: supporting.length > 0, memoryIds: supporting.map((m) => m.id) };
    });

    chains.push({
      id: `chain_${t.rootInference}`,
      title: t.title,
      nodes: [rootNode, ...consequenceNodes],
      confidence: scoreConfidence(active.filter((m) => root.memoryIds.includes(m.id)), now),
    });
  }
  return chains;
}

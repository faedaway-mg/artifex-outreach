// ─────────────────────────────────────────────────────────────────────────────
// Business Knowledge Graph (Phase 9).
//
// Connects evidence into one coherent picture:
//   Business → Services → Journey → Technologies → Locations → People →
//   Reviews → Growth signals → Observed friction → Opportunities
//
// The graph improves recommendation quality by making relationships explicit —
// e.g. a detected disconnected-systems technology links to a Data-Flow friction,
// which links to the recommended opportunity. Presentation/linking layer only.
// ─────────────────────────────────────────────────────────────────────────────
import type { Evidence } from "./evidence";
import type { OpportunityGraph } from "./opportunity-graph";
import { TAXONOMY } from "./friction-taxonomy";
import type { Lead, Contact } from "../types";

export type KgNodeType = "business" | "service" | "technology" | "location" | "person" | "review" | "growth" | "friction" | "opportunity";

export interface KgNode {
  id: string;
  type: KgNodeType;
  label: string;
}
export interface KgEdge {
  from: string;
  to: string;
  relation: string;
}

export interface KnowledgeGraph {
  nodes: KgNode[];
  edges: KgEdge[];
  /** Cross-linked insights that connect distinct evidence into one story. */
  connectedInsights: string[];
  stats: { nodes: number; edges: number; nodeTypes: number };
}

export interface KnowledgeGraphInput {
  lead: Lead;
  evidence: Evidence[];
  opportunityGraph: OpportunityGraph;
  contacts?: Contact[];
}

export function buildKnowledgeGraph(input: KnowledgeGraphInput): KnowledgeGraph {
  const { lead, evidence, opportunityGraph, contacts = [] } = input;
  const nodes: KgNode[] = [];
  const edges: KgEdge[] = [];
  const add = (n: KgNode) => {
    if (!nodes.find((x) => x.id === n.id)) nodes.push(n);
  };
  const link = (from: string, to: string, relation: string) => edges.push({ from, to, relation });

  const biz = `biz:${lead.id}`;
  add({ id: biz, type: "business", label: lead.businessName });

  const val = (field: string) => evidence.find((e) => e.field === field)?.value;

  // Services
  const services = String(val("services") ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  services.slice(0, 8).forEach((s, i) => {
    const id = `svc:${i}`;
    add({ id, type: "service", label: s });
    link(biz, id, "offers");
  });

  // Technologies
  for (const e of evidence.filter((e) => e.kind === "technology" && (e.field === "stack" || e.field === "cms" || e.field === "bookingFlow"))) {
    const id = `tech:${e.field}`;
    add({ id, type: "technology", label: String(e.value) });
    link(biz, id, "uses");
  }

  // Locations
  const locCount = Number(val("locations") ?? lead.locationsCount ?? 1);
  const locLabel = String(val("osmAddress") ?? `${lead.city}, ${lead.state}`);
  add({ id: "loc:primary", type: "location", label: locLabel });
  link(biz, "loc:primary", locCount > 1 ? `operates ${locCount} locations` : "located at");

  // People
  contacts.slice(0, 5).forEach((c, i) => {
    const id = `person:${i}`;
    add({ id, type: "person", label: `${c.name}${c.title ? ` (${c.title})` : ""}` });
    link(biz, id, "staffed by");
  });

  // Review themes
  for (const e of evidence.filter((e) => e.field.includes("review:"))) {
    const id = `review:${e.field}`;
    add({ id, type: "review", label: e.statement.split(":")[1]?.trim().slice(0, 60) ?? e.field });
    link(biz, id, "reviewed as");
  }

  // Growth signals
  for (const e of evidence.filter((e) => e.field.startsWith("growth:"))) {
    const id = e.field;
    add({ id, type: "growth", label: String(e.value).slice(0, 60) });
    link(biz, id, "shows");
  }

  // Friction (from the opportunity graph) + Opportunities
  for (const n of opportunityGraph.nodes) {
    const id = `friction:${n.domain}`;
    add({ id, type: "friction", label: n.domain });
    link(biz, id, n.observed ? "exhibits" : "at risk of");
  }
  const hl = opportunityGraph.highLeverage;
  if (hl) {
    const oppId = `opp:${hl.domain}`;
    add({ id: oppId, type: "opportunity", label: TAXONOMY[hl.domain].implementationApproaches[0] ?? hl.domain });
    link(`friction:${hl.domain}`, oppId, "addressed by");
    for (const d of hl.resolves) link(`friction:${hl.domain}`, `friction:${d}`, "relieves");
  }

  // Cross-linked insights — the payoff: connect distinct evidence into one story.
  const connectedInsights = buildInsights(evidence, opportunityGraph);

  return { nodes, edges, connectedInsights, stats: { nodes: nodes.length, edges: edges.length, nodeTypes: new Set(nodes.map((n) => n.type)).size } };
}

function buildInsights(evidence: Evidence[], graph: OpportunityGraph): string[] {
  const insights: string[] = [];
  const has = (field: string) => evidence.some((e) => e.field === field);

  if (has("friction:disconnectedSystems")) insights.push("Detected disconnected customer systems → likely double data entry → Data-Flow friction the discovery call should confirm.");
  if (evidence.some((e) => e.field.startsWith("growth:")) && graph.nodes.some((n) => n.domain === "Growth Readiness"))
    insights.push("Public growth momentum + growth-readiness friction → the roadmap should get ahead of scale before volume forces it.");
  if (has("friction:review:slowComms") && has("friction:noLeadForm"))
    insights.push("Reviews mention slow communication AND no lead form was found → intake + follow-up is the connected weak point.");
  if (graph.highLeverage) insights.push(`Highest-leverage intervention: ${graph.highLeverage.domain} — resolves ${graph.highLeverage.resolves.length} downstream issue(s).`);
  return insights;
}

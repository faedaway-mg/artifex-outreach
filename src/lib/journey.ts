// ─────────────────────────────────────────────────────────────────────────────
// The Understanding Journey — a PRESENTATION layer over the existing pipeline.
//
// The backend PipelineStage enum is unchanged (no migration, no data rewrite).
// This module reframes those stages as a Business-Technology-Consultant's journey:
// a business is progressively UNDERSTOOD, DISCUSSED, and PARTNERED WITH — not a
// deal that is chased and closed. The nine journey phases the operator sees are a
// deterministic mapping of the underlying stages (+ a few signals), so the UI can
// speak the consultative language while the engine stays exactly as it is.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, PipelineStage, StoredBusinessIntelligence } from "./types";
import { estimateRelationshipValue } from "./pricing";
import type { MaturityLevel } from "./intelligence/maturity";

export const JOURNEY_PHASES = [
  "Business Identified",
  "Business Understood",
  "Conversation Started",
  "Discovery Complete",
  "Evolution Plan Ready",
  "Focused Improvement",
  "Partnership Active",
  "Expansion Opportunity",
  "Relationship Mature",
] as const;
export type JourneyPhase = (typeof JOURNEY_PHASES)[number];

// Businesses not moving forward — kept out of the journey so the pipeline reads as
// progress, not a graveyard of dead deals.
export const ASIDE_STAGES: PipelineStage[] = ["Lost", "Disqualified", "Nurture"];

export interface JourneyPhaseMeta {
  phase: JourneyPhase;
  /** The consulting motion this phase represents. */
  motion: "Understand" | "Diagnose" | "Discuss" | "Plan" | "Implement" | "Partner";
  /** What the operator is doing here, in one calm line. */
  description: string;
  /** Tailwind text + border tone (mirrors the existing palette). */
  tone: string;
  dot: string;
}

export const JOURNEY_META: Record<JourneyPhase, JourneyPhaseMeta> = {
  "Business Identified": { phase: "Business Identified", motion: "Understand", description: "Discovered — not yet understood.", tone: "text-chalk-400 border-white/10", dot: "bg-chalk-500" },
  "Business Understood": { phase: "Business Understood", motion: "Diagnose", description: "Intelligence gathered; friction and opportunity are visible.", tone: "text-azure-300 border-azure-500/30", dot: "bg-azure-400" },
  "Conversation Started": { phase: "Conversation Started", motion: "Discuss", description: "A dialogue is open — earning the discovery call.", tone: "text-indigo-300 border-indigo-400/30", dot: "bg-indigo-400" },
  "Discovery Complete": { phase: "Discovery Complete", motion: "Diagnose", description: "The business has been heard; hypotheses are validated.", tone: "text-teal-300 border-teal-400/30", dot: "bg-teal-400" },
  "Evolution Plan Ready": { phase: "Evolution Plan Ready", motion: "Plan", description: "A sequenced improvement plan is prepared to share.", tone: "text-teal-200 border-teal-400/40", dot: "bg-teal-400" },
  "Focused Improvement": { phase: "Focused Improvement", motion: "Implement", description: "A first, high-leverage improvement is underway.", tone: "text-emerald-300 border-emerald-400/40", dot: "bg-emerald-400" },
  "Partnership Active": { phase: "Partnership Active", motion: "Partner", description: "An ongoing technology partnership is in motion.", tone: "text-emerald-300 border-emerald-400/50", dot: "bg-emerald-400" },
  "Expansion Opportunity": { phase: "Expansion Opportunity", motion: "Partner", description: "The relationship is ready to grow into new areas.", tone: "text-amber-300 border-amber-400/40", dot: "bg-amber-400" },
  "Relationship Mature": { phase: "Relationship Mature", motion: "Partner", description: "A trusted, long-standing partnership.", tone: "text-amber-200 border-amber-400/50", dot: "bg-amber-400" },
};

// Base mapping for the pre-partnership stages.
const STAGE_TO_PHASE: Partial<Record<PipelineStage, JourneyPhase>> = {
  Discovered: "Business Identified",
  Qualified: "Business Understood",
  "Analysis Ready": "Business Understood",
  "Deliverable Ready": "Business Understood",
  Contacted: "Conversation Started",
  "Follow-Up": "Conversation Started",
  "Meeting Booked": "Discovery Complete",
  "Discovery Complete": "Discovery Complete",
  "Proposal Sent": "Evolution Plan Ready",
};

/** Signals that split a Won business into a relationship sub-phase. */
function wonPhase(lead: Lead): JourneyPhase {
  const rel = estimateRelationshipValue(lead);
  const multiLocation = (lead.locationsCount ?? 1) > 1;
  const daysWon = Math.floor((Date.now() - +new Date(lead.updatedAt)) / 86_400_000);
  if (daysWon >= 270) return "Relationship Mature";
  if (multiLocation || rel.partnershipLikelihood >= 0.65) return "Expansion Opportunity";
  if (rel.partnershipLikelihood >= 0.45 || daysWon >= 45) return "Partnership Active";
  return "Focused Improvement";
}

export function journeyPhaseOf(lead: Lead): JourneyPhase | null {
  if (ASIDE_STAGES.includes(lead.pipelineStage)) return null;
  if (lead.pipelineStage === "Won") return wonPhase(lead);
  return STAGE_TO_PHASE[lead.pipelineStage] ?? "Business Identified";
}

/** Canonical stage a phase drops onto (keeps drag-to-reprioritize working). */
export function phaseToStage(phase: JourneyPhase): PipelineStage {
  const map: Record<JourneyPhase, PipelineStage> = {
    "Business Identified": "Discovered",
    "Business Understood": "Qualified",
    "Conversation Started": "Contacted",
    "Discovery Complete": "Discovery Complete",
    "Evolution Plan Ready": "Proposal Sent",
    "Focused Improvement": "Won",
    "Partnership Active": "Won",
    "Expansion Opportunity": "Won",
    "Relationship Mature": "Won",
  };
  return map[phase];
}

export function phaseIndex(phase: JourneyPhase): number {
  return JOURNEY_PHASES.indexOf(phase);
}

// ── Per-business understanding signals (used by the Today dashboard) ───────────
export interface UnderstandingSignals {
  hasIntelligence: boolean;
  hasConfirmedFriction: boolean;
  phase: JourneyPhase | null;
  isPartner: boolean;
}

// ── Opportunity metrics — the headline numbers that replace pipeline value ─────
export interface OpportunityMetrics {
  businessOpportunityScore: number | null; // avg improvement/lead score, 0..100
  relationshipPotential: number | null; // avg partnership likelihood, 0..100
  avgOpportunityConfidence: number | null; // avg evidence confidence, 0..100
  maturityDistribution: [string, number][]; // by maturity level (analyzed only)
  frictionDistribution: [string, number][]; // observed friction domains (analyzed only)
  readyForConversation: number; // understood, not yet in dialogue
  readyForPartnership: number; // strong recurring/expansion signal
  avgDiscoveryCompletion: number; // % of businesses-in-dialogue that finished discovery
  evolutionPlansReady: number; // businesses with a prepared evolution plan
  avgEvolutionProgress: number; // % of analyzed businesses with an evolution plan
}

const MATURITY_ORDER: MaturityLevel[] = ["Emerging", "Developing", "Established", "Advanced", "Strategic"];

export function opportunityMetrics(leads: Lead[], bi: StoredBusinessIntelligence[]): OpportunityMetrics {
  const biByLead = new Map(bi.map((b) => [b.leadId, b]));
  const avg = (ns: number[]) => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : null);

  // Opportunity score: prefer the engine's improvement score, fall back to leadScore.
  const opp = leads
    .map((l) => biByLead.get(l.id)?.improvementScore ?? l.leadScore)
    .filter((n): n is number => n != null);

  const rel = leads.filter((l) => l.estimatedValueHigh != null || l.estimatedValueLow != null).map((l) => estimateRelationshipValue(l).partnershipLikelihood * 100);

  const maturityCounts = new Map<string, number>();
  const frictionCounts = new Map<string, number>();
  for (const b of bi) {
    maturityCounts.set(b.profile.maturity.overall, (maturityCounts.get(b.profile.maturity.overall) ?? 0) + 1);
    for (const f of b.profile.frictionDomains ?? []) frictionCounts.set(f, (frictionCounts.get(f) ?? 0) + 1);
  }

  const understood = leads.filter((l) => journeyPhaseOf(l) === "Business Understood").length;
  const inDialogue = leads.filter((l) => {
    const p = journeyPhaseOf(l);
    return p === "Conversation Started" || p === "Discovery Complete";
  }).length;
  const discoveryDone = leads.filter((l) => journeyPhaseOf(l) === "Discovery Complete").length;
  const evolutionReady = leads.filter((l) => {
    const b = biByLead.get(l.id);
    return (b?.profile.evolution?.opportunities?.length ?? 0) > 0;
  }).length;
  const analyzed = leads.filter((l) => biByLead.has(l.id) || l.scoreBreakdown != null).length;
  const readyForPartnership = leads.filter((l) => (l.estimatedValueHigh != null) && estimateRelationshipValue(l).partnershipLikelihood >= 0.5).length;

  return {
    businessOpportunityScore: avg(opp),
    relationshipPotential: avg(rel),
    avgOpportunityConfidence: avg(bi.map((b) => b.evidenceConfidence)),
    maturityDistribution: MATURITY_ORDER.filter((l) => maturityCounts.has(l)).map((l) => [l, maturityCounts.get(l)!] as [string, number]),
    frictionDistribution: [...frictionCounts.entries()].sort((a, b) => b[1] - a[1]),
    readyForConversation: understood,
    readyForPartnership,
    avgDiscoveryCompletion: inDialogue + discoveryDone > 0 ? Math.round((discoveryDone / (inDialogue + discoveryDone)) * 100) : 0,
    evolutionPlansReady: evolutionReady,
    avgEvolutionProgress: analyzed > 0 ? Math.round((evolutionReady / analyzed) * 100) : 0,
  };
}

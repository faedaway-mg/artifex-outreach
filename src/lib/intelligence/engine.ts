// ─────────────────────────────────────────────────────────────────────────────
// Business Intelligence Engine — the source of truth for understanding a business.
//
// Flow:
//   Lead → (providers) Evidence → Friction classification → Opportunity Graph →
//   Technology Maturity → Business Evolution → Business Improvement Potential →
//   Business Technology Snapshot (presentation) → Operator Briefing
//
// The engine OWNS business understanding. Future data sources enrich it by adding
// providers (Phase 7) — the engine's behavior does not change. The Snapshot simply
// presents what the engine understands.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead, Finding, Contact } from "../types";
import type { WebsiteSignals } from "../scoring";
import { businessImprovementPotential, type BusinessImprovementPotential } from "../improvement";
import { buildSnapshot, type BusinessTechnologySnapshot } from "../snapshot";
import { enrich, type EnrichmentInput } from "./providers";
import { assertAuthorized, type PaidComputeAuthorization } from "../lead-sprint/cost-gate";
import "./providers/register"; // side-effect: registers first-gen enrichment providers
import { mergeEvidence, evidenceConfidenceScore, type Evidence } from "./evidence";
import { fuseEvidence, type FusedEvidence, type FusionResult } from "./fusion";
import { classify, TAXONOMY, type FrictionDomain } from "./friction-taxonomy";
import { buildOpportunityGraph, type OpportunityGraph, type ObservedFriction } from "./opportunity-graph";
import { assessMaturity, type MaturityAssessment, type MaturitySignals } from "./maturity";
import { projectEvolution, type EvolutionPlan } from "./evolution";
import { buildOperatorBriefing, type OperatorBriefing } from "./operator-briefing";
import { buildKnowledgeGraph, type KnowledgeGraph } from "./knowledge-graph";
import type { LearningStore } from "./learning";
import { buildBusinessProfile, type BusinessProfile } from "../business-intelligence";
import { extractPublicObservations, observationsToOpportunities } from "./public-observations";
import type { ModernizationOpportunity } from "../business-intelligence/types";

export interface BusinessIntelligence {
  leadId: string;
  businessName: string;
  industry: string;
  evidence: Evidence[];
  evidenceConfidence: number; // 0..100
  /** Fused evidence with provenance, corroboration, and contradictions (Phase 7). */
  fusedEvidence: FusedEvidence[];
  contradictions: FusionResult["contradictions"];
  frictionDomains: FrictionDomain[];
  opportunityGraph: OpportunityGraph;
  knowledgeGraph: KnowledgeGraph;
  maturity: MaturityAssessment;
  evolution: EvolutionPlan;
  improvement: BusinessImprovementPotential;
  snapshot: BusinessTechnologySnapshot;
  briefing: OperatorBriefing;
  /**
   * The structured Business Intelligence Profile — the single source of truth for
   * every downstream system (conversation, Review PDF, investment, roadmap, CRM,
   * follow-ups). Organizes the analysis above into four confidence-scored
   * dimensions and categorized modernization opportunities. See
   * src/lib/business-intelligence/ARCHITECTURE.md.
   */
  businessProfile: BusinessProfile;
  /** Which providers contributed vs. which planned ones are still dark. */
  providerCoverage: { contributing: string[]; evidenceCount: number };
}

export interface AnalyzeInput {
  lead: Lead;
  findings?: Finding[];
  contacts?: Contact[];
  signals?: WebsiteSignals;
  /** Optional learning store to bias friction confidence from past outcomes. */
  learning?: LearningStore;
  /** Optional pre-fetched enrichment content (lets providers run offline). */
  pages?: EnrichmentInput["pages"];
  reviews?: EnrichmentInput["reviews"];
  searchItems?: EnrichmentInput["searchItems"];
  corporateRecord?: EnrichmentInput["corporateRecord"];
  osmRecord?: EnrichmentInput["osmRecord"];
  /** Paid-compute authorization (#202). When scope is prospect-journey, DEEP ANALYSIS is finalist-gated:
   *  a non-finalist prospect is refused before any (metered) live enrichment runs. Omit for non-prospect
   *  analysis (offline/deterministic callers are unchanged). */
  paidAuthorization?: PaidComputeAuthorization;
}

export async function analyzeBusiness(input: AnalyzeInput): Promise<BusinessIntelligence> {
  const { lead, findings = [], contacts = [], signals, learning } = input;

  // PAID-COMPUTE GATE (#202): per-prospect deep analysis is finalist-gated. This throws (fail-closed)
  // before enrich() runs any metered live provider, so a non-finalist prospect cannot consume paid
  // analysis/capture credits. Non-prospect scopes (and callers that pass no authorization) are unchanged.
  if (input.paidAuthorization) assertAuthorized("deep-analysis", input.paidAuthorization);

  // 1) Enrichment → normalized, provider-agnostic evidence.
  const enrichInput: EnrichmentInput = { lead, findings, signals, pages: input.pages, reviews: input.reviews, searchItems: input.searchItems, corporateRecord: input.corporateRecord, osmRecord: input.osmRecord };
  const results = await enrich(enrichInput);
  const evidence = mergeEvidence(results);
  const evidenceConfidence = evidenceConfidenceScore(evidence);
  // Fusion (Phase 7): corroboration, provenance, contradictions over combined evidence.
  const fusion = fuseEvidence(results);

  // 2) Classify observed friction into standardized domains — from findings AND
  //    from any provider that emitted friction-kind evidence (website, tech, reviews).
  const observed: ObservedFriction[] = [];
  const seen = new Set<FrictionDomain>();
  const addFriction = (text: string, category: string | undefined, confidenceLabel: string) => {
    for (const domain of classify(text, category)) {
      if (seen.has(domain)) continue;
      seen.add(domain);
      const base = confidenceLabel === "Verified" ? 0.9 : confidenceLabel === "Likely" ? 0.6 : 0.3;
      const adjusted = learning ? learning.adjustConfidence(base, lead.industry, domain) : base;
      observed.push({
        domain,
        label: text,
        confidence: adjusted >= 0.75 ? "Verified" : adjusted >= 0.5 ? "Likely" : "Unknown",
        priority: TAXONOMY[domain].basePriority,
      });
    }
  };
  for (const f of findings) addFriction(f.observation, f.category, f.confidence);
  for (const e of evidence) if (e.kind === "friction") addFriction(e.statement, undefined, e.confidence);
  const frictionDomains = observed.map((o) => o.domain);

  // 3) Opportunity graph — connect friction into a causal story.
  const opportunityGraph = buildOpportunityGraph(observed);

  // 4) Technology maturity.
  const maturitySignals: MaturitySignals = {
    hasWebsite: !!lead.website,
    mobileFriendly: signals ? signals.mobileFriendly : null,
    hasBooking: signals ? signals.hasOnlineBooking : null,
    hasLeadForm: signals ? signals.hasLeadForm : null,
    hasPublicContact: !!(lead.publicEmail || lead.phone),
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    locationsCount: lead.locationsCount ?? 1,
    frictionDomains,
    analyzed: findings.length > 0 || !!signals,
  };
  const maturity = assessMaturity(maturitySignals);

  // 5) Business evolution — immediate / near-term / future arc.
  const growthSignal = (lead.reviewCount ?? 0) >= 150 || (lead.locationsCount ?? 1) > 1;
  const evolution = projectEvolution({ graph: opportunityGraph, maturity, locationsCount: lead.locationsCount ?? 1, growthSignal });

  // 6) Business Improvement Potential (existing model).
  const improvement = businessImprovementPotential(lead, signals, { hasApprovedFindings: findings.some((f) => f.approved) });

  // 7) Snapshot — the human-facing presentation of this understanding.
  const snapshot = buildSnapshot(lead, findings, contacts, signals);

  // 8) Knowledge graph — connect evidence into one coherent business picture.
  const knowledgeGraph = buildKnowledgeGraph({ lead, evidence, opportunityGraph, contacts });

  // 9) Operator briefing — one-screen decision surface.
  const briefing = buildOperatorBriefing({ businessName: lead.businessName, improvement, snapshot, maturity, graph: opportunityGraph, evolution });

  // 10) Business Intelligence Profile — organize everything above into the single
  //     structured profile every downstream system consumes. Reuses presence,
  //     evidence, maturity, and improvement; it does not re-analyze anything.
  const baseProfile = buildBusinessProfile({ lead, presence: snapshot.presence, evidence, websiteSignals: signals ?? null, maturity, improvement });

  // 10b) Deep public-site observation layer (M3) — structure-aware findings from the pages we already
  //      crawled, WITHOUT a new crawler. Aggregated, evidence-first, quantitative, and confined to what
  //      is directly observable in the public HTML. Merge as Observed opportunities and re-rank so the
  //      strongest surface first; downstream selection (review-evidence) handles topic dedupe.
  const observations = extractPublicObservations(input.pages ?? [], lead);
  const observationOpps = observationsToOpportunities(observations);
  const mergedOpps = dedupeById([...baseProfile.opportunities, ...observationOpps]).sort(
    (a, b) => b.confidence.score - a.confidence.score,
  );
  const businessProfile: BusinessProfile = { ...baseProfile, opportunities: mergedOpps };

  return {
    leadId: lead.id,
    businessName: lead.businessName,
    industry: lead.industry,
    evidence,
    evidenceConfidence,
    fusedEvidence: fusion.evidence,
    contradictions: fusion.contradictions,
    frictionDomains,
    opportunityGraph,
    knowledgeGraph,
    maturity,
    evolution,
    improvement,
    snapshot,
    briefing,
    businessProfile,
    // A provider "contributes" only when it actually produced evidence.
    providerCoverage: { contributing: results.filter((r) => r.ok && r.evidence.length > 0).map((r) => r.providerId), evidenceCount: evidence.length },
  };
}

/** Keep the first opportunity per id (base-profile opportunities win ties with observation-derived
 *  ones sharing an id — though ids are disjoint in practice: observation ids are `obs-*`). */
function dedupeById(opps: ModernizationOpportunity[]): ModernizationOpportunity[] {
  const seen = new Set<string>();
  const out: ModernizationOpportunity[] = [];
  for (const o of opps) { if (seen.has(o.id)) continue; seen.add(o.id); out.push(o); }
  return out;
}

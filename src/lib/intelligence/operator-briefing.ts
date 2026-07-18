// ─────────────────────────────────────────────────────────────────────────────
// Operator Briefing — the one-screen decision surface.
//
// The human should never read twenty pages of analysis. Given the full business
// intelligence, this distills the few things an operator needs to make a good
// call: why it matters, the strongest opportunities, the biggest uncertainty, the
// best angle, the questions to ask, maturity, potential, engagement fit, risks,
// and the single recommended next action.
// ─────────────────────────────────────────────────────────────────────────────
import type { BusinessImprovementPotential } from "../improvement";
import type { BusinessTechnologySnapshot } from "../snapshot";
import type { MaturityAssessment } from "./maturity";
import type { OpportunityGraph } from "./opportunity-graph";
import type { EvolutionPlan } from "./evolution";
import { engagementModel } from "../pricing";

export interface OperatorBriefing {
  businessName: string;
  whyItMatters: string;
  strongestOpportunities: string[];
  greatestUncertainty: string;
  bestOutreachAngle: string;
  bestDiscoveryQuestions: string[];
  likelyPriorities: string[];
  technologyMaturity: string;
  businessImprovementPotential: { score: number; treatment: string };
  recommendedEngagement: string;
  relationshipPotential: string;
  potentialRisks: string[];
  nextAction: string;
}

export interface BriefingInputs {
  businessName: string;
  improvement: BusinessImprovementPotential;
  snapshot: BusinessTechnologySnapshot;
  maturity: MaturityAssessment;
  graph: OpportunityGraph;
  evolution: EvolutionPlan;
}

export function buildOperatorBriefing(i: BriefingInputs): OperatorBriefing {
  const { improvement, snapshot, maturity, graph, evolution } = i;
  const rel = improvement.relationship;
  const doNotContact = improvement.treatment === "Do Not Contact";

  const strongest = graph.highLeverage
    ? [graph.highLeverage.domain + " (highest leverage)", ...maturity.priorityDimensions.slice(0, 2)]
    : maturity.priorityDimensions.slice(0, 3);

  const nextAction = doNotContact
    ? `Do not contact — ${improvement.hardOverride.reason}`
    : improvement.treatment === "Low-Confidence Research"
      ? "Hold for manual review — public evidence is too thin to reach out honestly."
      : `Approve ${snapshot.outreachAngle.category.toString().toLowerCase()} outreach, then aim for a short discovery conversation.`;

  return {
    businessName: i.businessName,
    whyItMatters: doNotContact
      ? `Screened out: ${improvement.hardOverride.reason}`
      : `${i.businessName} shows a connected opportunity story — ${graph.story}. ${improvement.rationale}`,
    strongestOpportunities: strongest,
    greatestUncertainty:
      snapshot.evidence.confidence < 45
        ? "Public evidence is thin — most conclusions are hypotheses to validate in conversation."
        : "Internal operations (follow-up, tooling, manual work) can't be seen from outside and must be confirmed.",
    bestOutreachAngle: `${snapshot.outreachAngle.category}: ${snapshot.outreachAngle.opener}`,
    bestDiscoveryQuestions: snapshot.discoveryQuestions.slice(0, 3),
    likelyPriorities: snapshot.conversationStrategy.likelyPriorities,
    technologyMaturity: `${maturity.overall} overall — most room in ${maturity.priorityDimensions.join(", ")}.`,
    businessImprovementPotential: { score: improvement.score, treatment: improvement.treatment },
    recommendedEngagement: `${engagementModel(rel.recommendedEntry).name} to start; ${evolution.recommendedSequence.length} step evolution path mapped.`,
    relationshipPotential: `${Math.round(rel.partnershipLikelihood * 100)}% partnership likelihood · 12-mo (confidence-adjusted) ≈ $${rel.confidenceAdjustedTwelveMonth.toLocaleString()}.`,
    potentialRisks: buildRisks(improvement, snapshot),
    nextAction,
  };
}

function buildRisks(improvement: BusinessImprovementPotential, snapshot: BusinessTechnologySnapshot): string[] {
  const risks: string[] = [];
  if (improvement.hardOverride.triggered) risks.push(`Hard override: ${improvement.hardOverride.reason}`);
  if (snapshot.evidence.confidence < 45) risks.push("Low evidence — don't over-claim in outreach.");
  if (snapshot.visibleFriction.every((f) => !f.safeForOutreach)) risks.push("No directly-observed friction to cite — lead with questions, not claims.");
  if (improvement.relationship.partnershipLikelihood < 0.35) risks.push("Looks one-off — don't push a retainer prematurely.");
  return risks.length ? risks : ["No major risks flagged."];
}

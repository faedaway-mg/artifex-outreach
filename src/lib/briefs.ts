// ─────────────────────────────────────────────────────────────────────────────
// Tiered deliverables built from a Business Technology Snapshot.
//
//  • Internal Opportunity Brief  — for the Artifex operator/closer. Full evidence,
//    scoring, hypotheses, risks, discovery questions, engagement + relationship
//    value, and communication strategy. NEVER shown to a prospect.
//
//  • Client Conversation Brief   — a concise, polished, REDACTED document for the
//    prospect. What we noticed (only directly-observed, safe items), what appears
//    to be working, what may be worth exploring, questions, and what a first
//    conversation would involve. No scores, no internal hypotheses stated as fact,
//    no investment numbers, and explicitly NOT a final diagnosis.
// ─────────────────────────────────────────────────────────────────────────────
import type { BusinessTechnologySnapshot } from "./snapshot";
import { engagementModel } from "./pricing";

export interface InternalOpportunityBrief {
  audience: "internal";
  businessName: string;
  treatment: string;
  improvementScore: number;
  strongestOpportunity: string;
  evidenceConfidence: number;
  observedStrengths: string[];
  visibleFriction: Array<{ observation: string; type: string; confidence: string; potentialImpact: string; safeForOutreach: boolean }>;
  hypothesesToValidate: string[];
  discoveryQuestions: string[];
  opportunityAreas: string[];
  recommendedEntry: string;
  relationshipValue: { entry: number; sixMonth: number; twelveMonthConfidenceAdjusted: number; partnershipLikelihood: number };
  outreachAngle: { category: string; opener: string; why: string };
  conversationStrategy: BusinessTechnologySnapshot["conversationStrategy"];
  hardOverride: { triggered: boolean; reason: string | null };
  risks: string[];
}

export interface ClientConversationBrief {
  audience: "client";
  businessName: string;
  intro: string;
  whatAppearsToBeWorking: string[];
  whatWeNoticed: string[]; // ONLY safe, directly-observed items
  whatMayBeWorthExploring: string[];
  questionsWeUnderstand: string[];
  whatTheNextConversationInvolves: string;
  disclaimer: string;
}

export function internalOpportunityBrief(s: BusinessTechnologySnapshot): InternalOpportunityBrief {
  const rel = s.improvement.relationship;
  return {
    audience: "internal",
    businessName: s.businessName,
    treatment: s.improvement.treatment,
    improvementScore: s.improvement.score,
    strongestOpportunity: s.outreachAngle.category as string,
    evidenceConfidence: s.evidence.confidence,
    observedStrengths: s.observedStrengths,
    visibleFriction: s.visibleFriction.map((f) => ({
      observation: f.observation,
      type: f.observationType,
      confidence: f.confidence,
      potentialImpact: f.potentialImpact,
      safeForOutreach: f.safeForOutreach,
    })),
    hypothesesToValidate: s.hypothesesToValidate,
    discoveryQuestions: s.discoveryQuestions,
    opportunityAreas: s.opportunityAreas as string[],
    recommendedEntry: engagementModel(rel.recommendedEntry).name,
    relationshipValue: {
      entry: rel.entry,
      sixMonth: rel.sixMonth,
      twelveMonthConfidenceAdjusted: rel.confidenceAdjustedTwelveMonth,
      partnershipLikelihood: rel.partnershipLikelihood,
    },
    outreachAngle: { category: s.outreachAngle.category as string, opener: s.outreachAngle.opener, why: s.outreachAngle.why },
    conversationStrategy: s.conversationStrategy,
    hardOverride: s.improvement.hardOverride,
    risks: buildRisks(s),
  };
}

export function clientConversationBrief(s: BusinessTechnologySnapshot): ClientConversationBrief {
  // Redaction: only directly-observed, safe items are stated as things "we noticed".
  const safe = s.visibleFriction.filter((f) => f.safeForOutreach);
  return {
    audience: "client",
    businessName: s.businessName,
    intro: `A short, outside-in look at ${s.businessName} — based only on what's publicly visible, meant as a starting point for a conversation, not a final assessment.`,
    whatAppearsToBeWorking: s.observedStrengths,
    whatWeNoticed: safe.map((f) => f.observation),
    // Inferences are softened into open possibilities, never asserted as fact.
    whatMayBeWorthExploring: (s.opportunityAreas as string[]).map((o) => `${o} — worth exploring together`),
    questionsWeUnderstand: s.discoveryQuestions,
    whatTheNextConversationInvolves:
      "A brief, low-pressure conversation to compare what we observed with how things actually work for you, and to agree on the smallest useful next step — if there is one.",
    disclaimer:
      "This is an outside-in starting point, not a diagnosis. Public information shows only part of the picture, and the best answer is sometimes a simpler existing tool rather than building something new.",
  };
}

function buildRisks(s: BusinessTechnologySnapshot): string[] {
  const risks: string[] = [];
  if (s.evidence.confidence < 40) risks.push("Low public evidence — most conclusions are hypotheses; do not over-claim in outreach.");
  if (s.improvement.hardOverride.triggered) risks.push(`Hard override active: ${s.improvement.hardOverride.reason}`);
  if (s.visibleFriction.every((f) => !f.safeForOutreach)) risks.push("No directly-observed friction to cite — lead with humility and questions, not claims.");
  if (s.improvement.relationship.partnershipLikelihood < 0.35) risks.push("Looks like a one-off; don't push a retainer prematurely.");
  return risks;
}

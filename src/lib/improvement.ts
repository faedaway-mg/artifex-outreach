// ─────────────────────────────────────────────────────────────────────────────
// Business Improvement Potential (BIP).
//
// The qualification model no longer asks "can this lead buy an ~$8,000 website?"
// It asks "how much value could the right technology improvements create here, and
// is outreach honest and appropriate?" Website quality is ONE signal — a poor site
// alone does not make a lead valuable, and an acceptable site does not disqualify a
// business with real operational opportunity.
//
// This is an additive layer: it reuses the deterministic computeScore() and the
// acquisition strategy engine (both already tested) and reframes them into an
// improvement-and-relationship view with a business-facing treatment category and
// explicit hard overrides.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "./types";
import { computeScore, type WebsiteSignals } from "./scoring";
import { computeAcquisitionStrategy, type StrategyInput } from "./acquisition/strategy";
import { estimateRelationshipValue, type RelationshipValue } from "./pricing";
import { treatmentForStrategy, type TreatmentCategory } from "./positioning";

export interface ImprovementDimensions {
  businessHealth: number; // /100 — credibility & stability
  activeDemand: number; // /100 — evidence customers are engaging
  technologyFriction: number; // /100 — visible tech/website friction (ONE signal)
  operationalComplexity: number; // /100 — likelihood of manual/repetitive burden
  growthSignals: number; // /100 — scaling / expansion signals
  customerExperience: number; // /100 — CX opportunity
  decisionMakerAccess: number; // /100 — reachable, identifiable owner
  abilityToInvest: number; // /100
  phasingPotential: number; // /100 — suits a phased engagement
  recurringPotential: number; // /100 — partnership likelihood
  evidenceConfidence: number; // /100 — confidence in public evidence
}

export interface HardOverride {
  triggered: boolean;
  reason: string | null;
}

export interface BusinessImprovementPotential {
  /** 0..100 headline score — value + appropriateness of pursuing this lead. */
  score: number;
  dimensions: ImprovementDimensions;
  treatment: TreatmentCategory;
  relationship: RelationshipValue;
  hardOverride: HardOverride;
  /** Which single signal is website quality worth here (for transparency). */
  websiteIsOneSignalNote: string;
  rationale: string;
}

function pct(n: number, max: number): number {
  return Math.max(0, Math.min(100, Math.round((n / max) * 100)));
}

export function businessImprovementPotential(
  lead: Lead,
  signals?: WebsiteSignals,
  input: StrategyInput = {},
): BusinessImprovementPotential {
  const score = computeScore(lead, signals);
  const b = score.breakdown;
  const strat = computeAcquisitionStrategy(lead, input);
  const relationship = estimateRelationshipValue(lead);

  const reviews = lead.reviewCount ?? 0;
  const rating = lead.rating ?? 0;
  const multiLocation = (lead.locationsCount ?? 1) > 1;

  const dimensions: ImprovementDimensions = {
    businessHealth: pct(b.publicReputation + (lead.businessStatus === "OPERATIONAL" ? 3 : 0), 13),
    activeDemand: pct(Math.min(200, reviews) / 200 * 10 + (rating >= 4 ? 3 : 0), 13),
    // Website is deliberately capped as ONE signal (its own 20-pt factor, shown as-is).
    technologyFriction: pct(b.websiteOpportunity, 20),
    operationalComplexity: pct(b.automationOpportunity + (multiLocation ? 4 : 0), 24),
    growthSignals: pct((multiLocation ? 10 : 0) + Math.min(10, reviews / 20) + b.triggerUrgency, 25),
    customerExperience: pct(b.websiteOpportunity * 0.6 + b.automationOpportunity * 0.4, 20),
    decisionMakerAccess: pct(b.contactability, 10),
    abilityToInvest: pct(b.abilityToPay, 15),
    phasingPotential: Math.round(relationship.partnershipLikelihood * 100),
    recurringPotential: Math.round(relationship.partnershipLikelihood * 100),
    evidenceConfidence: pct((lead.scoreBreakdown ? 6 : 3) + (reviews >= 40 ? 3 : 0) + (lead.website ? 2 : 0), 11),
  };

  // ── Hard overrides (ethics + data quality) ─────────────────────────────────
  const hardOverride = evaluateOverride(lead, input);

  // Blend of value signals (not website-dominant) + appropriateness.
  const value =
    0.16 * dimensions.operationalComplexity +
    0.14 * dimensions.customerExperience +
    0.12 * dimensions.growthSignals +
    0.12 * dimensions.recurringPotential +
    0.12 * dimensions.businessHealth +
    0.1 * dimensions.abilityToInvest +
    0.1 * dimensions.activeDemand +
    0.08 * dimensions.technologyFriction + // ONE signal, modest weight
    0.06 * dimensions.decisionMakerAccess;
  const appropriateness = 0.5 + 0.5 * (dimensions.evidenceConfidence / 100);
  const rawScore = Math.round(value * appropriateness);

  const treatment: TreatmentCategory = hardOverride.triggered
    ? "Do Not Contact"
    : treatmentForStrategy(strat.strategy, {
        relationshipLean: relationship.partnershipLikelihood >= 0.5,
        lowConfidence: dimensions.evidenceConfidence < 40,
      });

  const finalScore = treatment === "Do Not Contact" ? 0 : Math.max(0, Math.min(100, rawScore));

  return {
    score: finalScore,
    dimensions,
    treatment,
    relationship,
    hardOverride,
    websiteIsOneSignalNote:
      `Website friction contributes ${dimensions.technologyFriction}/100 to this view and is weighted at 8% — it is one signal, not the deciding factor.`,
    rationale: buildRationale(lead, dimensions, treatment, relationship, hardOverride),
  };
}

function evaluateOverride(lead: Lead, input: StrategyInput): HardOverride {
  if (lead.businessStatus === "CLOSED_PERMANENTLY")
    return { triggered: true, reason: "Business appears closed or inactive." };
  if (input.suppressed) return { triggered: true, reason: "Contact is suppressed or has opted out." };
  if (input.optedOut) return { triggered: true, reason: "Contact opted out of outreach." };
  if (!lead.publicEmail && !lead.phone && !lead.website)
    return { triggered: true, reason: "No reliable contact route — contact information is unusable." };
  if ((lead.reviewCount ?? 0) === 0 && (lead.rating ?? 0) === 0 && !lead.website)
    return { triggered: true, reason: "No credible evidence of active business activity." };
  return { triggered: false, reason: null };
}

function buildRationale(
  lead: Lead,
  d: ImprovementDimensions,
  treatment: TreatmentCategory,
  rel: RelationshipValue,
  override: HardOverride,
): string {
  if (override.triggered) return `${lead.businessName}: Do Not Contact — ${override.reason}`;
  const strongest = strongestOpportunity(d);
  return [
    `${lead.businessName} → ${treatment}.`,
    `Strongest opportunity signal: ${strongest}.`,
    `Recommended entry: ${rel.recommendedEntry.replace(/-/g, " ")} (partnership likelihood ${Math.round(rel.partnershipLikelihood * 100)}%).`,
    d.evidenceConfidence < 40 ? "Public evidence is thin — treat conclusions as hypotheses to validate." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function strongestOpportunity(d: ImprovementDimensions): string {
  const ranked: Array<[string, number]> = [
    ["operational efficiency", d.operationalComplexity],
    ["customer experience", d.customerExperience],
    ["growth readiness", d.growthSignals],
    ["recurring partnership", d.recurringPotential],
    ["technology friction", d.technologyFriction],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0][0];
}

// ─────────────────────────────────────────────────────────────────────────────
// LEAD SPRINT ADAPTER (track #183) — maps the OUTPUTS of the existing deterministic scorers
// (scoring.ts `ScoreResult` + targeting/scoring.ts `TargetingScore`) plus a lead's location and the
// free-pipeline gate outcomes into a `SprintCandidate`. It is PURE: the real cron/read-model computes
// the two scores from live data and passes them here, so the engine consumes real leads through one
// well-defined seam without this module reaching into storage. No paid calls, ever.
// ─────────────────────────────────────────────────────────────────────────────
import type { ScoreResult } from "../scoring";
import type { TargetingScore } from "../targeting/scoring";
import { podForLocation } from "./pods";
import { scoreSendValue } from "./send-value";
import { scoreProductionConfidence } from "./production-confidence";
import type { SprintCandidate } from "./engine";

/** Free-pipeline gate outcomes that aren't recoverable from the score objects — supplied explicitly
 *  (each is a cheap, deterministic upstream check). Keeping them explicit avoids smuggling hidden policy. */
export interface SprintGateOutcomes {
  isDuplicate: boolean;
  isSuppressed: boolean;
  quickFixEligible: boolean;
  clearsMarginGate: boolean;
  materialEvidence: boolean;        // ≥1 specific verified finding + supported consequence
  reachableContact: boolean;        // verified recipient with a real role
  voiceGenerationResolved: boolean; // journey voice (Matt/Lucas) resolved
  compatibleTrustAvailable: boolean;// matching-generation trust asset exists OR is producible (not transcript-only)
  /** Optional explicit cheap-qualification result; when omitted, derived from targeting + opportunity. */
  cheaplyQualified?: boolean;
}

export interface BuildSprintCandidateInput {
  lead: { id: string; businessName: string; city: string; state: string };
  opportunity: ScoreResult;   // computeScore(lead)
  targeting: TargetingScore;  // scoreTarget(adapter(lead))
  gates: SprintGateOutcomes;
}

/** Build one SprintCandidate from real scorer outputs. Deterministic; no I/O; no paid compute. */
export function buildSprintCandidate(input: BuildSprintCandidateInput): SprintCandidate {
  const { lead, opportunity, targeting, gates } = input;
  const pod = podForLocation(lead.city, lead.state);
  const notTerminal = targeting.terminalExclusions.length === 0;

  // Cheap qualification default: not terminal, persona not a hard "do not prepare", and a minimal
  // opportunity floor — all from already-computed free signals. Callers may override explicitly.
  const cheaplyQualified =
    gates.cheaplyQualified ??
    (notTerminal &&
      targeting.promotionState !== "DO_NOT_PREPARE" &&
      targeting.promotionState !== "INELIGIBLE" &&
      opportunity.total >= 45); // Tier B floor (scoring.ts)

  const sendValue = scoreSendValue({
    leadId: lead.id,
    reputationStrength: targeting.components.reputationStrength,
    digitalReputationGap: targeting.components.digitalReputationGap,
    decisionMakerAccess: targeting.components.decisionMakerAccess,
    customerValue: targeting.components.customerValue,
    marketFit: targeting.components.marketFit,
    websiteOpportunity: opportunity.breakdown.websiteOpportunity,
    abilityToPay: opportunity.breakdown.abilityToPay,
    contactability: opportunity.breakdown.contactability,
    podPriority: pod.priority,
  });

  const productionConfidence = scoreProductionConfidence({
    leadId: lead.id,
    notTerminal,
    quickFixEligible: gates.quickFixEligible,
    materialEvidence: gates.materialEvidence,
    reachableContact: gates.reachableContact,
    clearsMarginGate: gates.clearsMarginGate,
    voiceGenerationResolved: gates.voiceGenerationResolved,
    compatibleTrustAvailable: gates.compatibleTrustAvailable,
    personaFit: targeting.personaFit,
    evidenceSpecificity: targeting.components.evidenceSpecificity,
  });

  return {
    leadId: lead.id,
    businessName: lead.businessName,
    city: lead.city,
    state: lead.state,
    podId: pod.pod?.id ?? null,
    podPriority: pod.priority,
    sendValue,
    productionConfidence,
    isDuplicate: gates.isDuplicate,
    isSuppressed: gates.isSuppressed,
    cheaplyQualified,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRICT QUALIFICATION FUNNEL — a business becomes HIGH-CONFIDENCE READY_TO_SELL
// only if it passes the ENTIRE usable funnel. Existence + an email is never enough
// (PRINCIPLE 4). Hard disqualifiers are preserved, never deleted, never turned into
// "call later" tasks, and never counted as sendable inventory (PRINCIPLE 2/3).
//
// This is the single place that answers "is this lead genuinely sendable, and why /
// why not?" by composing the specialist gates (contactability, commercial fit,
// competitive overlap, jurisdiction) with the existing fixability/evidence engine.
// It NEVER lowers a threshold to fill capacity — a shortage is a discovery problem.
// ─────────────────────────────────────────────────────────────────────────────
import type { Contactability } from "./contactability";
import type { CommercialFit } from "./commercial-fit";
import type { CompetitiveOverlap } from "./competitive-overlap";
import type { JurisdictionVerdict } from "./jurisdiction";

export type Disqualifier =
  | "NO_WEBSITE"
  | "NO_EMAIL"
  | "SUPPRESSED"
  | "BOUNCED"
  | "INACTIVE_BUSINESS"
  | "COMPETITIVE_OVERLAP"
  | "NO_OBSERVED_DEFECT"
  | "NO_SKU_MATCH"
  | "WEAK_EVIDENCE"
  | "WEAK_COMMERCIAL_FIT"
  | "THIN_MARGIN"
  | "JURISDICTION_BLOCKED"
  | "JURISDICTION_UNKNOWN"
  | "EMAIL_UNVERIFIED";

export type FunnelStage =
  | "DISCOVERED"
  | "WEBSITE_EXISTS"
  | "USABLE_EMAIL"
  | "ACTIVE_BUSINESS"
  | "COMMERCIAL_FIT"
  | "OBSERVED_DEFECT"
  | "SKU_MATCH"
  | "FIXABILITY"
  | "EVIDENCE_CONFIDENCE"
  | "MARGIN_SCOPE"
  | "JURISDICTION_SENDABLE"
  | "HIGH_CONFIDENCE_READY_TO_SELL";

const STAGE_ORDER: FunnelStage[] = [
  "DISCOVERED", "WEBSITE_EXISTS", "USABLE_EMAIL", "ACTIVE_BUSINESS", "COMMERCIAL_FIT",
  "OBSERVED_DEFECT", "SKU_MATCH", "FIXABILITY", "EVIDENCE_CONFIDENCE", "MARGIN_SCOPE",
  "JURISDICTION_SENDABLE", "HIGH_CONFIDENCE_READY_TO_SELL",
];

export const MIN_QUALIFYING_CONFIDENCE = 0.6; // mirrors evidence-gate MIN_OFFER_CONFIDENCE

export interface QualificationInput {
  hasWebsite: boolean;
  contactability: Contactability;
  suppressed?: boolean;
  businessActive?: boolean; // false only when evidenced closed/inactive
  commercialFit: CommercialFit;
  overlap: CompetitiveOverlap;
  /** From assessFixability(offer): a confident, ready-to-sell repair exists. */
  readyToSellFix: boolean;
  matchedSku: string | null;
  /** offer.confidence (0..1). */
  confidence: number;
  /** offer has at least one concrete observed defect. */
  hasObservedDefect: boolean;
  /** economics.clearsMarginGate. */
  clearsMarginGate: boolean;
  jurisdiction: JurisdictionVerdict;
}

export interface Qualification {
  stageReached: FunnelStage;
  /** High-confidence sendable: passed every gate AND has an auto-sendable address. */
  readyToSell: boolean;
  /** Has a usable email at all (auto or with approval). */
  emailable: boolean;
  /** Auto-sendable without operator approval (reputation-safe). */
  emailableAuto: boolean;
  disqualifiers: Disqualifier[];
  reasons: string[];
}

/**
 * Run a lead through the full funnel. The FIRST hard failure stops advancement and
 * records the disqualifier; every failure is recorded (not just the first) so the
 * dashboard can bucket honestly. readyToSell requires reaching the end AND an
 * auto-sendable address AND a jurisdiction that affirmatively allows the send.
 */
export function qualifyLead(input: QualificationInput): Qualification {
  const disqualifiers: Disqualifier[] = [];
  const reasons: string[] = [];
  let stage: FunnelStage = "DISCOVERED";
  const advance = (to: FunnelStage) => { if (STAGE_ORDER.indexOf(to) > STAGE_ORDER.indexOf(stage)) stage = to; };

  // 1) WEBSITE — no website means this Quick-Fix model does not apply (PRINCIPLE 3).
  if (!input.hasWebsite) { disqualifiers.push("NO_WEBSITE"); reasons.push("no website — website Quick-Fix does not apply"); }
  else advance("WEBSITE_EXISTS");

  // 2) USABLE EMAIL — no email means no Quick-Cash outbound (PRINCIPLE 2).
  const c = input.contactability;
  if (!c.hasEmail) { disqualifiers.push("NO_EMAIL"); reasons.push("no usable email — terminal for the cold channel"); }
  else advance("USABLE_EMAIL");
  if (c.state === "NO_EMAIL") { /* already covered */ }
  if (input.suppressed) { disqualifiers.push("SUPPRESSED"); reasons.push("suppressed / unsubscribed"); }
  // A recorded bounce shows up as no auto/approval sendability with hasEmail true.
  if (c.hasEmail && !c.emailableAuto && !c.emailableWithApproval) { disqualifiers.push("BOUNCED"); reasons.push("address present but not sendable (prior bounce)"); }

  // 3) ACTIVE BUSINESS
  if (input.businessActive === false) { disqualifiers.push("INACTIVE_BUSINESS"); reasons.push("business appears closed/inactive"); }
  else advance("ACTIVE_BUSINESS");

  // 4) COMPETITIVE OVERLAP — a business that sells our category is not a basic-repair prospect (PART G).
  if (input.overlap.disqualifies) { disqualifiers.push("COMPETITIVE_OVERLAP"); reasons.push(input.overlap.reason); }

  // 5) COMMERCIAL FIT
  if (!input.commercialFit.makesCommercialSense) { disqualifiers.push("WEAK_COMMERCIAL_FIT"); reasons.push("weak commercial fit — a productized repair may not make sense here"); }
  else advance("COMMERCIAL_FIT");

  // 6) OBSERVED DEFECT
  if (!input.hasObservedDefect) { disqualifiers.push("NO_OBSERVED_DEFECT"); reasons.push("no concrete observed defect"); }
  else advance("OBSERVED_DEFECT");

  // 7) SKU MATCH
  if (!input.matchedSku) { disqualifiers.push("NO_SKU_MATCH"); reasons.push("no approved SKU match"); }
  else advance("SKU_MATCH");

  // 8) FIXABILITY — a confident, ready-to-sell repair exists.
  if (input.readyToSellFix) advance("FIXABILITY");

  // 9) EVIDENCE CONFIDENCE
  if (input.confidence < MIN_QUALIFYING_CONFIDENCE) { disqualifiers.push("WEAK_EVIDENCE"); reasons.push(`evidence confidence ${input.confidence.toFixed(2)} below ${MIN_QUALIFYING_CONFIDENCE}`); }
  else advance("EVIDENCE_CONFIDENCE");

  // 10) MARGIN / CONTAINED SCOPE
  if (!input.clearsMarginGate) { disqualifiers.push("THIN_MARGIN"); reasons.push("does not clear the margin/economics gate"); }
  else advance("MARGIN_SCOPE");

  // 11) JURISDICTION — hard input; UNKNOWN fails closed (PART M).
  if (input.jurisdiction.state === "UNKNOWN") { disqualifiers.push("JURISDICTION_UNKNOWN"); reasons.push("jurisdiction unknown — failing closed"); }
  else if (!input.jurisdiction.coldSendAllowed) { disqualifiers.push("JURISDICTION_BLOCKED"); reasons.push(input.jurisdiction.reasons[0] ?? "jurisdiction not cleared for cold email"); }
  else advance("JURISDICTION_SENDABLE");

  // Email quality gate for AUTO send (catch-all/unverified requires operator approval).
  if (c.hasEmail && !c.emailableAuto && c.emailableWithApproval) { disqualifiers.push("EMAIL_UNVERIFIED"); reasons.push("email unverified/catch-all — needs operator approval before spending mailbox reputation"); }

  const hardBlocked = disqualifiers.some((d) => d !== "EMAIL_UNVERIFIED");
  const reachedJurisdictionStage = STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf("JURISDICTION_SENDABLE");
  const readyToSell =
    !hardBlocked &&
    input.readyToSellFix &&
    c.emailableAuto &&
    input.jurisdiction.coldSendAllowed &&
    reachedJurisdictionStage;

  if (readyToSell) { advance("HIGH_CONFIDENCE_READY_TO_SELL"); reasons.push("passed the full funnel — high-confidence ready to sell"); }

  return {
    stageReached: stage,
    readyToSell,
    emailable: c.emailableAuto || c.emailableWithApproval,
    emailableAuto: c.emailableAuto,
    disqualifiers: [...new Set(disqualifiers)],
    reasons,
  };
}

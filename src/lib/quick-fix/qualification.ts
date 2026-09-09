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
  | "EMAIL_UNVERIFIED"
  | "CUSTOMER_LANGUAGE";

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
  /**
   * True when EVERY customer-facing surface of the offer passes the plain-language
   * (no-jargon) gate — no unexplained acronym, internal SKU key, developer/marketing
   * jargon, or vague non-action in copy the owner reads. Absent (undefined) means the
   * check was not applicable (no offer to inspect) and does NOT block; false means the
   * copy actively failed the gate and the lead CANNOT be ready to sell. See
   * customer-language.ts. This never changes factual scope — it only gates on clarity.
   */
  customerLanguageClean?: boolean;
  /** Optional: the specific customer-language problems (for the dashboard reason). */
  customerLanguageProblems?: string[];

  /**
   * OFFER-READINESS signal (Part U) — DISTINCT from sales qualification. `true` when the
   * assembled offer artifact passed the deterministic readiness gate (no BLOCKER issues);
   * `false` when a material blocker exists (stale PDF, raw URL, opener mismatch, price
   * disagreement, dark pattern, …). Absent (undefined) means readiness was not evaluated
   * (no artifact assembled) and is NOT treated as a failure. This never changes SALES
   * qualification (readyToSell): a sales-qualified lead whose artifact is unready is still
   * sales-qualified — it is simply not READY_TO_SEND until the blockers clear.
   */
  offerReady?: boolean;
  /** Optional: short readiness blocker reasons (for the dashboard), when unready. */
  offerReadinessBlockers?: string[];
}

export interface Qualification {
  stageReached: FunnelStage;
  /** High-confidence sendable: passed every gate AND has an auto-sendable address.
   *  NOTE: this is SALES qualification only — it is NOT gated by offer readiness. */
  readyToSell: boolean;
  /** Has a usable email at all (auto or with approval). */
  emailable: boolean;
  /** Auto-sendable without operator approval (reputation-safe). */
  emailableAuto: boolean;
  disqualifiers: Disqualifier[];
  reasons: string[];

  /**
   * READY_TO_SEND — the composite send gate (Part U). True only when the lead is
   * SALES-qualified (readyToSell) AND the assembled offer artifact is materially ready
   * (offerReady !== false). A materially-unready offer is NEVER READY_TO_SEND, but this
   * NEVER downgrades readyToSell — readiness is surfaced separately so the operator sees
   * "sales-qualified, but the artifact has blockers" as a distinct state.
   */
  readyToSend: boolean;
  /** The offer-readiness verdict as fed in (undefined ⇒ not evaluated). */
  offerReady?: boolean;
  /** Short readiness blocker reasons (only when offerReady === false). */
  offerReadinessBlockers?: string[];
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

  // CUSTOMER-LANGUAGE (no-jargon) — copy the owner reads must be plain. A hard failure
  // here is terminal for READY_TO_SELL: we never cold-send an offer whose customer copy
  // still exposes unexplained acronyms / internal SKU keys / jargon. `undefined` means
  // not applicable (no offer inspected) and never blocks; `false` blocks.
  if (input.customerLanguageClean === false) {
    disqualifiers.push("CUSTOMER_LANGUAGE");
    const detail = (input.customerLanguageProblems ?? []).slice(0, 3).join("; ");
    reasons.push(`customer-facing copy fails the plain-language gate${detail ? `: ${detail}` : ""}`);
  }

  const hardBlocked = disqualifiers.some((d) => d !== "EMAIL_UNVERIFIED");
  const reachedJurisdictionStage = STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf("JURISDICTION_SENDABLE");
  const readyToSell =
    !hardBlocked &&
    input.readyToSellFix &&
    c.emailableAuto &&
    input.jurisdiction.coldSendAllowed &&
    reachedJurisdictionStage;

  if (readyToSell) { advance("HIGH_CONFIDENCE_READY_TO_SELL"); reasons.push("passed the full funnel — high-confidence ready to sell"); }

  // OFFER READINESS (Part U) — surfaced SEPARATELY. A materially-unready offer is not
  // READY_TO_SEND, but sales qualification (readyToSell) is untouched. `undefined` ⇒ not
  // evaluated ⇒ does not block send-readiness beyond the sales gate.
  const offerUnready = input.offerReady === false;
  if (offerUnready) {
    const detail = (input.offerReadinessBlockers ?? []).slice(0, 3).join("; ");
    reasons.push(`offer artifact not ready to send${detail ? `: ${detail}` : ""} (sales qualification unaffected)`);
  }
  const readyToSend = readyToSell && !offerUnready;

  return {
    stageReached: stage,
    readyToSell,
    emailable: c.emailableAuto || c.emailableWithApproval,
    emailableAuto: c.emailableAuto,
    disqualifiers: [...new Set(disqualifiers)],
    reasons,
    readyToSend,
    offerReady: input.offerReady,
    offerReadinessBlockers: offerUnready ? input.offerReadinessBlockers : undefined,
  };
}

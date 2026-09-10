// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION CONFIDENCE (master mandate §6, §32 — track #183 → gate #202).
//
// Send Value ranks WHO is most worth sending. Production Confidence answers the different, gating
// question: if we spend paid compute on this candidate, how confident are we the package will actually
// PASS every hard contract (offer eligibility, material evidence, reachable contact, coherent voice,
// pricing)? It is PURE + DETERMINISTIC and uses only cheap signals the free pipeline already has.
//
// A candidate must clear the minimum Production Confidence contract BEFORE any expensive production
// begins (§6: "A candidate must meet the minimum Send Value / Production Confidence contract BEFORE
// expensive production begins"). This is what keeps the paid-compute gate (#202) from burning credits
// on leads that were never going to ship.
// ─────────────────────────────────────────────────────────────────────────────

export const PRODUCTION_CONFIDENCE_VERSION = "v1-2026-09";

export interface ProductionConfidenceInput {
  leadId: string;
  // ── hard prerequisites (any false here caps confidence low or blocks entirely) ──
  notTerminal: boolean;          // not suppressed/rejected/duplicate/synthetic/ineligible (targeting terminal)
  quickFixEligible: boolean;     // a clean flat-scope Quick-Fix offer is constructible (pricing.ts)
  materialEvidence: boolean;     // ≥1 specific, verified website finding with a supported consequence
  reachableContact: boolean;     // a verified recipient with a real role (not general-inbox/none)
  clearsMarginGate: boolean;     // pricing clears the margin gate (automation-policy)
  // ── voice coherence readiness (§12): a compatible trust generation is available/producible ──
  voiceGenerationResolved: boolean; // the lead's journey voice (Matt default / Lucas legacy) is resolved
  compatibleTrustAvailable: boolean; // a matching-generation trust asset exists OR is producible (not transcript-only)
  // ── soft quality signals (raise confidence within the band) ──
  personaFit: boolean;           // fundamentals match the persona
  evidenceSpecificity: number;   // 0..15 (targeting) — richer evidence → higher confidence
}

export type ProductionConfidenceBand = "HIGH" | "MEDIUM" | "LOW" | "BLOCKED";

export interface ProductionConfidence {
  version: string;
  leadId: string;
  total: number;                 // 0..100
  band: ProductionConfidenceBand;
  /** True only when every hard prerequisite passes — the minimum contract to enter paid production. */
  meetsMinimumContract: boolean;
  /** Hard-prerequisite failures — each keeps the candidate OUT of paid production (never operator work). */
  blockers: string[];
  reasons: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute Production Confidence. Pure + deterministic. If any hard prerequisite fails, the candidate is
 * BLOCKED (does not meet the minimum contract) and must be rejected/replaced — NOT pushed to an operator.
 */
export function scoreProductionConfidence(i: ProductionConfidenceInput): ProductionConfidence {
  const blockers: string[] = [];
  if (!i.notTerminal) blockers.push("terminal exclusion (suppressed/rejected/duplicate/synthetic/ineligible)");
  if (!i.quickFixEligible) blockers.push("no constructible flat-scope Quick-Fix offer");
  if (!i.materialEvidence) blockers.push("no material, evidence-backed problem (specific finding + supported consequence)");
  if (!i.reachableContact) blockers.push("no verified reachable decision-maker contact");
  if (!i.clearsMarginGate) blockers.push("pricing does not clear the margin gate");
  if (!i.voiceGenerationResolved) blockers.push("journey voice generation unresolved");
  if (!i.compatibleTrustAvailable) blockers.push("no compatible trust video available or producible (transcript-only not allowed)");

  const meetsMinimumContract = blockers.length === 0;

  // Confidence points (only meaningful once the contract is met; a blocked candidate is reported as 0).
  // Weighted toward the signals that most predict a clean Breakbot pass.
  let s = 0;
  if (i.quickFixEligible) s += 25;
  if (i.materialEvidence) s += 20;
  if (i.reachableContact) s += 15;
  if (i.clearsMarginGate) s += 10;
  if (i.compatibleTrustAvailable) s += 10;
  if (i.personaFit) s += 10;
  s += (clamp(i.evidenceSpecificity, 0, 15) / 15) * 10; // 0..10 for evidence richness

  const total = meetsMinimumContract ? round(clamp(s, 0, 100)) : 0;
  const band: ProductionConfidenceBand = !meetsMinimumContract
    ? "BLOCKED"
    : total >= 80
      ? "HIGH"
      : total >= 60
        ? "MEDIUM"
        : "LOW";

  const reasons = meetsMinimumContract
    ? [
        `Minimum production contract met — eligible for paid production behind the cost gate.`,
        `Offer eligible, material evidence present, reachable contact, pricing clears margin.`,
        `Voice coherence ready; evidence specificity ${i.evidenceSpecificity}/15; persona fit ${i.personaFit ? "yes" : "no"}.`,
      ]
    : blockers.map((b) => `BLOCKED: ${b}`);

  return { version: PRODUCTION_CONFIDENCE_VERSION, leadId: i.leadId, total, band, meetsMinimumContract, blockers, reasons };
}

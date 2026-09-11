// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE-INVENTORY RECONCILIATION DECISION (Problem-Reality amendment §36-§39, §42, §49).
//
// The pure decision for ONE stored offer during a full active-inventory reconciliation:
// keep it (and with what Problem Reality verdict) or retire it (with a canonical reason).
// The funnel order matches the amendment's cost-aware pipeline — cheap geography/ICP/closed
// checks BEFORE the problem-reality judgement — so an out-of-market or dead business is
// rejected before it consumes any deeper analysis. PURE + unit-testable; the script does I/O.
// ─────────────────────────────────────────────────────────────────────────────
import type { ProblemReality, ProblemRealityInput } from "./problem-reality";
import { assessProblemReality } from "./problem-reality";
import { isConcreteDefect, isMaterialFinding } from "./evidence-gate";

export type RetireReason =
  | "Wrong geography"
  | "Closed"
  | "Wrong ICP / too enterprise"
  | "Off-strategy / legacy"
  | "No material problem"
  | "Problem disproven"
  | null;

export interface ReconcileInput {
  inMarket: boolean;
  businessClosed: boolean;
  /** Lead Sprint classification disposition. */
  leadDisposition: "active" | "LEGACY_ARCHIVED" | "DISQUALIFIED_LEGACY";
  reality: ProblemReality;
}

export interface ReconcileDecision {
  keep: boolean;
  retireReason: RetireReason;
  realityVerdict: ProblemReality["verdict"];
  realityScore: number;
}

/**
 * Decide the fate of one stored offer. Geography → business-alive → ICP → problem-reality,
 * cheapest gate first (§36). The first failing gate wins its canonical retire reason.
 */
export function reconcileDecision(input: ReconcileInput): ReconcileDecision {
  const base = { realityVerdict: input.reality.verdict, realityScore: input.reality.score };
  if (!input.inMarket) return { keep: false, retireReason: "Wrong geography", ...base };
  if (input.businessClosed) return { keep: false, retireReason: "Closed", ...base };
  if (input.leadDisposition === "DISQUALIFIED_LEGACY") return { keep: false, retireReason: "Wrong ICP / too enterprise", ...base };
  if (input.leadDisposition === "LEGACY_ARCHIVED") return { keep: false, retireReason: "Off-strategy / legacy", ...base };
  if (input.reality.verdict === "NO_MATERIAL_PROBLEM") return { keep: false, retireReason: "No material problem", ...base };
  if (input.reality.verdict === "DISPROVEN") return { keep: false, retireReason: "Problem disproven", ...base };
  return { keep: true, retireReason: null, ...base };
}

export interface ConservativeRealitySignals {
  finding: { observation: string; whyItMatters?: string } | null;
  /** A READY screenshot exists for the finding (offline proxy for observed/evidence-backed). */
  hasEvidence: boolean;
  /** The package's surfaces are coherent (no coherence BLOCK). */
  coherent: boolean;
}

/**
 * A CONSERVATIVE, offline Problem Reality assessment for reconciliation. Without a live
 * browser counter-test we can never mint PROVEN for a functional-path claim — so a path
 * claim tops out at PLAUSIBLE (stays BLOCKED / not Ready-to-Send until a real counter-test
 * runs), while an immaterial finding correctly becomes NO_MATERIAL_PROBLEM (retire). This
 * is the fail-closed behavior the amendment wants: the active pool shrinks, and nothing
 * reaches Ready-to-Send on stored data alone.
 */
export function conservativeReality(sig: ConservativeRealitySignals): ProblemReality {
  const input: ProblemRealityInput = {
    finding: sig.finding,
    observed: sig.hasEvidence,
    repeatable: sig.hasEvidence,
    specific: sig.finding ? isConcreteDefect(sig.finding.observation) : false,
    evidenceBacked: sig.hasEvidence,
    fixable: !!sig.finding,
    coherent: sig.coherent,
    truthful: sig.coherent,
    counterTest: null, // no live counter-test offline → path claims cannot be PROVEN here
  };
  // Guard: an immaterial finding is NO_MATERIAL_PROBLEM regardless of the rest.
  if (sig.finding && !isMaterialFinding({ observation: sig.finding.observation, whyItMatters: sig.finding.whyItMatters ?? "" })) {
    return assessProblemReality({ ...input });
  }
  return assessProblemReality(input);
}

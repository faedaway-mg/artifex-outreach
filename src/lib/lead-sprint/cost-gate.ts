// ─────────────────────────────────────────────────────────────────────────────
// PAID-COMPUTE COST GATE (master mandate §6, §35, §43 — track #202, the SINGLE authoritative boundary).
//
// The free Lead Sprint pipeline (#183) runs continuously at zero paid cost. This gate is the ONE place
// that separates that free work from expensive downstream production: deep paid analysis, evidence /
// research capture, ElevenLabs voice, personalized rendering, and any other metered generation.
//
// Three fail-closed rules, enforced together:
//   1. GATE OFF BY DEFAULT — until an operator explicitly enables it (env), NO paid compute runs. This is
//      how "Do not generate paid assets before the gate exists / is deployed" is enforced in code.
//   2. FINALISTS ONLY — a candidate must meet the minimum Production Confidence contract AND be a ranked
//      finalist sized to near-term capacity. Broad discovery never reaches here.
//   3. LEGAL CROSSING ONLY — the first free→paid transition must come from `ranked_pool`; already-paid
//      states may continue. No path skips the gate.
//
// COST LEDGER (§35, §43): we always record MEASURABLE units (requests, minutes, renders). We attach a USD
// figure ONLY when a provider unit-rate is configured; otherwise the cost is honestly `null` ("unknown —
// not fabricated"). Archived-junk cleanup spends ZERO here because it never becomes a finalist (§43).
// ─────────────────────────────────────────────────────────────────────────────
import { canEnterPaid, isPaidState, type LeadSprintState } from "./states";

export const COST_GATE_VERSION = "v1-2026-09";

export type PaidComputeKind =
  | "discovery"          // note: discovery is CHEAP and runs in the free pipeline; included for ledger completeness
  | "deep-analysis"
  | "evidence-capture"
  | "elevenlabs-voice"
  | "render"
  | "email-delivery"     // nonzero only when a paid delivery provider is used; Google API sends are ~zero marginal
  | "other-metered";

// The metered kinds this gate actually guards (discovery/email-delivery are ledger-only, not gated here).
const GUARDED_KINDS = new Set<PaidComputeKind>(["deep-analysis", "evidence-capture", "elevenlabs-voice", "render", "other-metered"]);

const bool = (v: string | undefined): boolean => v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "yes";

/**
 * Whether paid compute is enabled. FAIL-CLOSED: false unless the operator explicitly sets the env flag.
 * Read fresh every call (never memoized) so an operator toggle takes effect without a redeploy.
 */
export function paidComputeEnabled(): boolean {
  return bool(process.env.LEAD_SPRINT_PAID_COMPUTE_ENABLED);
}

export interface PaidComputeContext {
  leadId: string;
  state: LeadSprintState;
  /** Production Confidence minimum contract met (production-confidence.ts). */
  meetsMinimumContract: boolean;
  /** Selected as a ranked finalist sized to near-term capacity (engine.ts finalist selection). */
  isRankedFinalist: boolean;
}

export class PaidComputeGateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PaidComputeGateError";
    this.code = code;
  }
}

/**
 * Assert that a paid-compute operation is permitted. Throws PaidComputeGateError (fail-closed) when any
 * rule fails. Non-guarded kinds (discovery/email-delivery) are always allowed to be *recorded* but this
 * function is intended for the metered kinds; callers wrap the actual paid provider call.
 */
export function assertPaidComputeAllowed(kind: PaidComputeKind, ctx: PaidComputeContext): void {
  if (!GUARDED_KINDS.has(kind)) return; // discovery/email-delivery are not gated (they are cheap/near-zero)

  if (!paidComputeEnabled()) {
    throw new PaidComputeGateError("GATE_DISABLED", "Paid-compute gate is disabled — no metered production may run (fail-closed).");
  }
  if (!ctx.meetsMinimumContract) {
    throw new PaidComputeGateError("CONTRACT_UNMET", `Candidate ${ctx.leadId} does not meet the minimum Production Confidence contract.`);
  }
  if (!ctx.isRankedFinalist) {
    throw new PaidComputeGateError("NOT_FINALIST", `Candidate ${ctx.leadId} is not a ranked finalist within near-term capacity.`);
  }
  // First crossing must originate from ranked_pool; continuing paid work is fine once already in a paid state.
  if (!canEnterPaid(ctx.state) && !isPaidState(ctx.state)) {
    throw new PaidComputeGateError("ILLEGAL_CROSSING", `Candidate ${ctx.leadId} in state '${ctx.state}' cannot enter paid production.`);
  }
}

/** Convenience wrapper: assert the gate, then run the paid operation. Nothing runs if the gate refuses. */
export async function guardPaidCompute<T>(kind: PaidComputeKind, ctx: PaidComputeContext, run: () => Promise<T>): Promise<T> {
  assertPaidComputeAllowed(kind, ctx);
  return run();
}

// ── COST LEDGER (honest; §35 "Do not invent unavailable costs") ─────────────────

export interface UnitRate {
  usdPerUnit: number;
  unit: string;   // "request" | "minute" | "render" | "message" | ...
  basis: string;  // where the rate came from (env-configured / published provider price)
}

/**
 * Operator-configured provider unit rates (env). ONLY these produce a USD figure. Anything not configured
 * stays `null` in the ledger — never guessed. Env format: LEAD_SPRINT_RATE_<KIND>=<usdPerUnit> (e.g.
 * LEAD_SPRINT_RATE_DISCOVERY=0.032). Units are documented per kind below.
 */
function configuredRate(kind: PaidComputeKind): UnitRate | null {
  const envKey = `LEAD_SPRINT_RATE_${kind.toUpperCase().replace(/-/g, "_")}`;
  const raw = process.env[envKey];
  const usd = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(usd) || usd < 0) return null;
  const unit = kind === "elevenlabs-voice" ? "minute" : kind === "render" ? "render" : kind === "email-delivery" ? "message" : "request";
  return { usdPerUnit: usd, unit, basis: `env ${envKey}` };
}

export interface CostEntry {
  kind: PaidComputeKind;
  units: number;              // ALWAYS measurable (requests / minutes / renders / messages)
  unit: string;
  knownUsd: number | null;    // null = unknown, honestly not fabricated
  basis: string;
}

/**
 * Record a cost entry. `units` (measurable) is always captured; USD is attached only when a rate is
 * configured for that kind. This backs the operator cost ledger without ever inventing a number.
 */
export function recordCost(kind: PaidComputeKind, units: number): CostEntry {
  const rate = configuredRate(kind);
  if (!rate) {
    const unit = kind === "elevenlabs-voice" ? "minute" : kind === "render" ? "render" : kind === "email-delivery" ? "message" : "request";
    return { kind, units, unit, knownUsd: null, basis: "unknown — no configured provider rate (not fabricated)" };
  }
  return { kind, units, unit: rate.unit, knownUsd: Math.round(units * rate.usdPerUnit * 10000) / 10000, basis: rate.basis };
}

export interface CostLedgerSummary {
  entries: CostEntry[];
  knownUsdTotal: number;               // sum of entries with a known USD
  unknownCostKinds: PaidComputeKind[]; // kinds we spent units on but cannot price (honest gap)
}

/** Summarize a set of cost entries: known USD total + the honest list of kinds whose USD is unknown. */
export function summarizeCostLedger(entries: CostEntry[]): CostLedgerSummary {
  let knownUsdTotal = 0;
  const unknown = new Set<PaidComputeKind>();
  for (const e of entries) {
    if (e.knownUsd == null) { if (e.units > 0) unknown.add(e.kind); }
    else knownUsdTotal += e.knownUsd;
  }
  return { entries, knownUsdTotal: Math.round(knownUsdTotal * 10000) / 10000, unknownCostKinds: [...unknown] };
}

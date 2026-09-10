// ─────────────────────────────────────────────────────────────────────────────
// NATIONAL LEAD SPRINT — CANDIDATE STATE MODEL (master mandate §4-8, tracks #183/#202).
//
// ONE authoritative lifecycle for a Sprint candidate. The FREE half (#183) runs continuously with no
// paid compute; the PAID half begins only after a candidate crosses the paid-compute cost gate (#202)
// as a ranked finalist. The boundary between the two halves is explicit here so no free-stage code can
// ever imply paid work has happened, and no paid stage can be reached without passing the gate.
//
// States never skip the gate: `RANKED_POOL` (free) → gate(#202) → `PRODUCTION_FINALIST` (paid-eligible).
// Terminal dispositions (rejected/retired/replaced) keep bad leads OUT of operator work (§33).
// ─────────────────────────────────────────────────────────────────────────────

// ── FREE half — zero/low-cost, always running (#183) ──
export const FREE_STATES = [
  "discovered",        // surfaced by national discovery
  "deduped",           // survived duplicate detection (domain/place/phone/name)
  "suppressed",        // matched suppression/opt-out — terminal, kept for audit (NOT contacted)
  "cheaply_qualified", // passed deterministic cheap qualification (no paid calls)
  "scored",            // Send Value + Production Confidence computed
  "ranked_pool",       // in the ranked qualified pool, behind the paid-compute boundary
] as const;

// ── PAID half — only ranked finalists that crossed the cost gate (#202) ──
export const PAID_STATES = [
  "production_finalist", // selected finalist that PASSED the cost gate — paid production authorized
  "deep_analysis",       // paid deep analysis / evidence capture in progress
  "narration",           // narration drafted (cheap) ahead of voice
  "voiceover",           // ElevenLabs Matt voiceover generated + persisted (paid)
  "rendering",           // personalized video render in progress
  "breakbot",            // full Breakbot preflight running
  "ready_to_send",       // fully prepared package behind the delivery gate (NOT delivered)
] as const;

// ── Terminal dispositions — never operator work (§33), kept for audit ──
export const TERMINAL_STATES = [
  "rejected",  // failed a hard contract before any paid spend
  "retired",   // aged out / market cooled / superseded
  "replaced",  // pulled from the pool because a higher-ranked candidate took its slot
  "stale",     // freshness re-gate found the demonstrated problem materially changed
] as const;

export const LEAD_SPRINT_STATES = [...FREE_STATES, ...PAID_STATES, ...TERMINAL_STATES] as const;
export type LeadSprintState = (typeof LEAD_SPRINT_STATES)[number];

const FREE = new Set<string>(FREE_STATES);
const PAID = new Set<string>(PAID_STATES);
const TERMINAL = new Set<string>(TERMINAL_STATES);

/** True for states that must NEVER have consumed paid compute. The cost gate depends on this. */
export function isFreeState(s: LeadSprintState): boolean {
  return FREE.has(s);
}
/** True for states that are only reachable AFTER passing the paid-compute cost gate (#202). */
export function isPaidState(s: LeadSprintState): boolean {
  return PAID.has(s);
}
export function isTerminalState(s: LeadSprintState): boolean {
  return TERMINAL.has(s);
}

// The single crossing point. A candidate may only move from the free pool into paid production by
// becoming a production_finalist, which the cost gate (#202) authorizes. Enforced by canEnterPaid().
export const PAID_ENTRY_STATE: LeadSprintState = "production_finalist";

/**
 * Whether a candidate in state `from` may enter paid production. The ONLY legal free→paid transition is
 * ranked_pool → production_finalist, and only the cost gate may perform it. Any other attempt is a bug.
 */
export function canEnterPaid(from: LeadSprintState): boolean {
  return from === "ranked_pool";
}

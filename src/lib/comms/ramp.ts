// ─────────────────────────────────────────────────────────────────────────────
// WARM-UP-AWARE AUTONOMOUS SEND RAMP (master mandate §28-30, §34).
//
// A per-lane state machine that decides how many REAL prospect sends a Google Workspace lane may make
// today. It sits ON TOP of the deployed transport (config.ts laneDailyCap/laneEnabled) and NEVER raises
// the underlying lane cap — effective capacity is always min(ramp-level cap, configured lane cap), and 0
// when the lane is disabled or PAUSED.
//
// PROMOTION IS EARNED BY HEALTHY DELIVERY SIGNALS, NOT BY THE CALENDAR (§30) — elapsed days and Warmup
// Inbox message counts never promote a lane. Real seed placement governs: if Outlook is still landing in
// Junk, the lane does NOT auto-promote (§29's preserved observation). Autonomous promotion tops out at
// Level 4 (8/lane); Levels 5-7 (12/15/20) require explicit operator approval and are never reached on
// their own. Auto-safety lowers or PAUSES a lane on risk. Lanes are independent — NO quota transfer.
// ─────────────────────────────────────────────────────────────────────────────
import { laneDailyCap, laneEnabled } from "./google-workspace/config";

export const RAMP_VERSION = "v1-2026-09";

export type RampState = "WARMING" | "RAMPING" | "ESTABLISHED" | "PAUSED";

// Level → sends/lane/day. Levels 1-4 are autonomous-reachable; 5-7 require operator approval (§30).
export const RAMP_LEVEL_CAPS: Record<number, number> = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 12, 6: 15, 7: 20 };
export const MAX_AUTONOMOUS_LEVEL = 4; // 8/lane/day — the underlying max is never raised autonomously
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 7;

export type SeedPlacement = "inbox" | "junk" | "not_tested";

/** Honest, separated deliverability signals (§29) — transport health is NOT deliverability. */
export interface LaneDeliverabilitySignals {
  transportHealthy: boolean;   // Gmail API auth/send works
  authHealthy: boolean;        // OAuth credentials valid
  gmailSeed: SeedPlacement;    // operator-recorded seed placement
  outlookSeed: SeedPlacement;  // operator-recorded seed placement (first tests were Junk — preserved)
  bounceRate: number;          // 0..1 over the recent real-send window
  spamComplaintRate: number;   // 0..1 over the recent real-send window
  sentInWindow: number;        // real sends observed — sample size for trusting the signal
}

export interface LaneRampStatus {
  laneId: string;
  state: RampState;
  level: number;               // 1..7
  levelCap: number;            // sends/lane/day for this level
  configuredLaneCap: number;   // the deployed underlying cap (config.ts)
  effectiveDailyCap: number;   // min(levelCap, configuredLaneCap), 0 if disabled/paused
  enabled: boolean;
}

// Thresholds — deliberately conservative. Promotion needs a real sample and clean signals; safety trips
// well before problems compound. These are policy constants, not magic scattered through the code.
const PROMOTE_MIN_SAMPLE = 20;        // enough real sends to trust placement/bounce signals
const PROMOTE_MAX_BOUNCE = 0.02;      // ≤2% bounces to promote
const PROMOTE_MAX_SPAM = 0.001;       // ≤0.1% complaints to promote
const SAFETY_BOUNCE = 0.05;           // ≥5% bounces → PAUSE
const SAFETY_SPAM = 0.005;            // ≥0.5% complaints → PAUSE

/** Compute the current effective capacity for a lane given its ramp state (pure; reads config for caps). */
export function laneRampStatus(input: { laneId: string; state: RampState; level: number }, env: NodeJS.ProcessEnv = process.env): LaneRampStatus {
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.floor(input.level)));
  const levelCap = RAMP_LEVEL_CAPS[level] ?? RAMP_LEVEL_CAPS[MIN_LEVEL];
  const configuredLaneCap = laneDailyCap(input.laneId, env);
  const enabled = laneEnabled(input.laneId, env);
  // Effective cap NEVER exceeds the configured lane cap, and is 0 when disabled or paused.
  const effectiveDailyCap = !enabled || input.state === "PAUSED" ? 0 : Math.min(levelCap, configuredLaneCap);
  return { laneId: input.laneId, state: input.state, level, levelCap, configuredLaneCap, effectiveDailyCap, enabled };
}

export type RampDecision = "hold" | "promote" | "demote" | "pause" | "resume";

export interface RampEvaluation {
  laneId: string;
  from: { state: RampState; level: number };
  to: { state: RampState; level: number };
  decision: RampDecision;
  reasons: string[];
}

export interface EvaluateRampOpts {
  /** Operator approval to promote past the autonomous ceiling (Level 4 → 5/6/7). Default false. */
  operatorApprovedAboveL4?: boolean;
}

/**
 * Evaluate one lane's ramp transition from its current state + real signals. PURE + DETERMINISTIC.
 * Safety first (pause/demote on risk), then earned promotion (healthy signals + real sample + Outlook not
 * Junk), else hold. Never promotes on elapsed time or Warmup Inbox counts.
 */
export function evaluateRamp(
  current: { laneId: string; state: RampState; level: number },
  signals: LaneDeliverabilitySignals,
  opts: EvaluateRampOpts = {},
): RampEvaluation {
  const laneId = current.laneId;
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, Math.floor(current.level)));
  const from = { state: current.state, level };
  const reasons: string[] = [];

  // ── 1. Hard safety: infrastructure broken or risk signals high → PAUSE (0 capacity) ──
  if (!signals.transportHealthy || !signals.authHealthy) {
    reasons.push("Transport/auth unhealthy — pausing the lane (no sends).");
    return { laneId, from, to: { state: "PAUSED", level }, decision: "pause", reasons };
  }
  if (signals.bounceRate >= SAFETY_BOUNCE || signals.spamComplaintRate >= SAFETY_SPAM) {
    reasons.push(`Risk signals high (bounce ${(signals.bounceRate * 100).toFixed(1)}%, spam ${(signals.spamComplaintRate * 100).toFixed(2)}%) — pausing.`);
    return { laneId, from, to: { state: "PAUSED", level }, decision: "pause", reasons };
  }

  // ── 2. Junk placement: never promote; step down one level if actively ramping above Level 1 ──
  const gmailJunk = signals.gmailSeed === "junk";
  const outlookJunk = signals.outlookSeed === "junk";
  if (gmailJunk || outlookJunk) {
    if (level > MIN_LEVEL) {
      reasons.push(`${outlookJunk ? "Outlook" : "Gmail"} seed placement is Junk — lowering one level and holding (§29/§30).`);
      return { laneId, from, to: { state: "RAMPING", level: level - 1 }, decision: "demote", reasons };
    }
    reasons.push(`${outlookJunk ? "Outlook" : "Gmail"} seed placement is Junk — holding at Level 1, no auto-promotion.`);
    return { laneId, from, to: { state: "WARMING", level }, decision: "hold", reasons };
  }

  // ── 3. If currently PAUSED and signals are now clean, resume conservatively (do not leap levels) ──
  if (current.state === "PAUSED") {
    reasons.push("Signals recovered — resuming the lane at its current level (no level jump).");
    return { laneId, from, to: { state: "RAMPING", level }, decision: "resume", reasons };
  }

  // ── 4. Earned promotion: healthy signals + real sample + Gmail inbox + Outlook not Junk (§30) ──
  const ceiling = opts.operatorApprovedAboveL4 ? MAX_LEVEL : MAX_AUTONOMOUS_LEVEL;
  const sampleOk = signals.sentInWindow >= PROMOTE_MIN_SAMPLE;
  const cleanRates = signals.bounceRate <= PROMOTE_MAX_BOUNCE && signals.spamComplaintRate <= PROMOTE_MAX_SPAM;
  const gmailInbox = signals.gmailSeed === "inbox";
  const outlookConfirmed = signals.outlookSeed === "inbox"; // "not_tested" is NOT confirmation — cannot promote on it

  if (level < ceiling && sampleOk && cleanRates && gmailInbox && outlookConfirmed) {
    const nextLevel = level + 1;
    const nextState: RampState = nextLevel >= MAX_AUTONOMOUS_LEVEL ? "ESTABLISHED" : "RAMPING";
    reasons.push(`Healthy signals over ${signals.sentInWindow} real sends (bounce ${(signals.bounceRate * 100).toFixed(1)}%, spam ${(signals.spamComplaintRate * 100).toFixed(2)}%), Gmail+Outlook Inbox — promoting to Level ${nextLevel}.`);
    return { laneId, from, to: { state: nextState, level: nextLevel }, decision: "promote", reasons };
  }

  // ── 5. Otherwise hold and explain what's missing (never a date-based promotion) ──
  if (level >= ceiling) reasons.push(opts.operatorApprovedAboveL4 ? "At the maximum level." : `At the autonomous ceiling (Level ${MAX_AUTONOMOUS_LEVEL} = 8/lane); higher levels need operator approval.`);
  if (!sampleOk) reasons.push(`Insufficient real-send sample (${signals.sentInWindow}/${PROMOTE_MIN_SAMPLE}) — cannot yet trust placement/bounce signals.`);
  if (!gmailInbox) reasons.push(`Gmail seed placement not confirmed Inbox (${signals.gmailSeed}).`);
  if (!outlookConfirmed) reasons.push(`Outlook seed placement not confirmed Inbox (${signals.outlookSeed}) — will not promote on an untested mailbox.`);
  const holdState: RampState = level >= MAX_AUTONOMOUS_LEVEL ? "ESTABLISHED" : current.state === "WARMING" ? "WARMING" : "RAMPING";
  return { laneId, from, to: { state: holdState, level }, decision: "hold", reasons };
}

/** Combined daily prospect capacity across both lanes — the SUM of each lane's OWN effective cap (NO
 *  quota transfer between lanes; a lane's unused capacity never moves to the other). */
export function combinedRampCapacity(lanes: LaneRampStatus[]): number {
  return lanes.reduce((sum, l) => sum + Math.max(0, l.effectiveDailyCap), 0);
}

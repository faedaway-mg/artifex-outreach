// ─────────────────────────────────────────────────────────────────────────────
// Prospect priority — combine FIT (foundational) with RECEPTIVITY (a bounded booster) and the
// MARKET tie-breaker, so a qualified business with real current evidence can surface ahead of an
// otherwise-comparable one — WITHOUT letting a weak signal overpower dramatically better
// fundamentals, and without making a tiny/low-quality business attractive just for having a signal.
//
// Plus the learning-loop reader: aggregate real outcomes (sends/replies/meetings) by market tier
// and signal presence so we can start testing which signals actually predict interest.
// ─────────────────────────────────────────────────────────────────────────────
import type { MarketTier } from "../geo-market";

// Receptivity can nudge, never dominate. Capped well below the spread of fit fundamentals, so a
// clearly-better prospect always wins and a signal only decides genuine near-ties.
const RECEPTIVITY_CAP = 6;

export interface PriorityResult {
  /** Foundational fit (computeScore total, 0..100+). */
  fit: number;
  /** Bounded receptivity contribution (0..RECEPTIVITY_CAP; 0 unless established). */
  receptivityBoost: number;
  /** Final ranking value. */
  total: number;
  because: string[];
}

/**
 * Rank a prospect. Fit is foundational; receptivity is a small capped boost applied ONLY to
 * established businesses (so tiny businesses never rise on a signal alone). Market receptivity is
 * already folded into `fitScore` by computeScore (regional tie-breaker) — kept separate here only
 * for explanation.
 */
export function prospectPriority(input: { fitScore: number; receptivity: number; established: boolean }): PriorityResult {
  const receptivityBoost = input.established ? Math.min(RECEPTIVITY_CAP, Math.max(0, input.receptivity)) : 0;
  const because: string[] = [`Fit ${Math.round(input.fitScore)}`];
  if (receptivityBoost > 0) because.push(`+${receptivityBoost} observed receptivity signal`);
  else if (input.receptivity > 0 && !input.established) because.push("receptivity signal present but business not established — no boost");
  else because.push("no observed receptivity signal yet");
  return { fit: input.fitScore, receptivityBoost, total: input.fitScore + receptivityBoost, because };
}

// ── Learning loop: outcomes by market tier × signal presence (reuses existing send/reply/meeting data) ──
export interface OutcomeCell {
  key: string;
  emailed: number;
  replies: number;
  meetings: number;
  replyRate: number;   // replies / emailed
  meetingRate: number; // meetings / emailed
}

/** Aggregate sent-email outcomes by (market tier × has-signal). Lets us test H1 (regional vs
 *  primary), H2 (signal vs no-signal) and combinations — pure, no second analytics system. */
export function signalOutcomeExperiment(input: {
  sends: Array<{ leadId: string; marketTier: MarketTier; hasSignal: boolean }>;
  repliedLeadIds: Set<string>;
  metLeadIds: Set<string>;
}): Record<string, OutcomeCell> {
  const cells: Record<string, OutcomeCell> = {};
  for (const s of input.sends) {
    const key = `${s.marketTier}/${s.hasSignal ? "signal" : "no-signal"}`;
    const c = (cells[key] ??= { key, emailed: 0, replies: 0, meetings: 0, replyRate: 0, meetingRate: 0 });
    c.emailed += 1;
    if (input.repliedLeadIds.has(s.leadId)) c.replies += 1;
    if (input.metLeadIds.has(s.leadId)) c.meetings += 1;
  }
  for (const c of Object.values(cells)) {
    c.replyRate = c.emailed ? Math.round((c.replies / c.emailed) * 1000) / 1000 : 0;
    c.meetingRate = c.emailed ? Math.round((c.meetings / c.emailed) * 1000) / 1000 : 0;
  }
  return cells;
}

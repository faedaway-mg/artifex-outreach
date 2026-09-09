// ─────────────────────────────────────────────────────────────────────────────
// VOICE CAPACITY / USAGE — pure aggregation of what Acquisition OS has actually
// generated, plus at-a-glance capacity estimates. Deterministic (now is injected).
//
// Counts EVERY successful generation (VOICEOVER_READY), including regenerations —
// each consumed real provider capacity. Uses ACTUAL audio duration. Never counts
// failed attempts (no valid audio) and never fabricates a remaining quota when no
// monthly allowance is configured. ElevenLabs remains authoritative for real capacity;
// these are our own internal estimates for operator awareness — warnings are
// informational and never block generation.
// ─────────────────────────────────────────────────────────────────────────────
import type { VoiceoverRecord } from "./store";

export interface VoiceUsageConfig {
  monthlyMinuteBudget: number | null;
  billingResetDay: number | null; // day-of-month (1-28) the allowance resets; null ⇒ calendar month
}

export interface VoiceUsage {
  periodStart: string;
  periodEnd: string; // the reset boundary (next occurrence)
  minutesThisPeriod: number;
  minutesToday: number;
  minutesThisWeek: number;
  voiceoversThisPeriod: number;
  averageSeconds: number;
  monthlyMinuteBudget: number | null;
  percentUsed: number | null; // null when no budget configured
  minutesRemaining: number | null; // null when no budget configured
  estimatedVideosRemainingAtAverage: number | null;
  estimatedVideosRemainingAt30s: number | null;
  billingResetDate: string | null;
  warningLevel: 0 | 75 | 90 | 100; // informational threshold crossed
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// The billing period [start,end) containing `now`. With a reset day, the period runs
// resetDay→resetDay; otherwise it is the calendar month.
function billingPeriod(now: Date, resetDay: number | null): { start: Date; end: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (resetDay && resetDay >= 1 && resetDay <= 28) {
    const thisMonthReset = new Date(Date.UTC(y, m, resetDay, 0, 0, 0));
    if (now >= thisMonthReset) {
      return { start: thisMonthReset, end: new Date(Date.UTC(y, m + 1, resetDay, 0, 0, 0)) };
    }
    return { start: new Date(Date.UTC(y, m - 1, resetDay, 0, 0, 0)), end: thisMonthReset };
  }
  return { start: new Date(Date.UTC(y, m, 1, 0, 0, 0)), end: new Date(Date.UTC(y, m + 1, 1, 0, 0, 0)) };
}

/** Compute the capacity meter from the READY voiceover records. Pure. */
export function computeVoiceUsage(records: VoiceoverRecord[], config: VoiceUsageConfig, nowIso: string): VoiceUsage {
  const now = new Date(nowIso);
  const { start, end } = billingPeriod(now, config.billingResetDay);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const weekStart = new Date(dayStart.getTime() - 6 * 24 * 3600 * 1000);

  // Only successful generations with a real duration count as consumed capacity.
  const ready = records.filter((r) => r.status === "VOICEOVER_READY" && (r.durationSeconds ?? 0) > 0);

  let secThisPeriod = 0;
  let secToday = 0;
  let secThisWeek = 0;
  let countThisPeriod = 0;
  let secAllForAvg = 0;
  let countAllForAvg = 0;

  for (const r of ready) {
    const sec = r.durationSeconds ?? 0;
    const created = new Date(r.createdAt);
    secAllForAvg += sec;
    countAllForAvg += 1;
    if (created >= start && created < end) {
      secThisPeriod += sec;
      countThisPeriod += 1;
    }
    if (created >= dayStart) secToday += sec;
    if (created >= weekStart) secThisWeek += sec;
  }

  const averageSeconds = countAllForAvg > 0 ? secAllForAvg / countAllForAvg : 0;
  const minutesThisPeriod = secThisPeriod / 60;

  const budget = config.monthlyMinuteBudget;
  const hasBudget = typeof budget === "number" && budget > 0;
  const percentUsed = hasBudget ? Math.min(100, Math.round((minutesThisPeriod / budget!) * 100)) : null;
  const minutesRemaining = hasBudget ? Math.max(0, budget! - minutesThisPeriod) : null;

  const remainingSeconds = minutesRemaining != null ? minutesRemaining * 60 : null;
  const estAtAvg = remainingSeconds != null && averageSeconds > 0 ? Math.floor(remainingSeconds / averageSeconds) : null;
  const estAt30 = remainingSeconds != null ? Math.floor(remainingSeconds / 30) : null;

  let warningLevel: 0 | 75 | 90 | 100 = 0;
  if (percentUsed != null) {
    if (percentUsed >= 100) warningLevel = 100;
    else if (percentUsed >= 90) warningLevel = 90;
    else if (percentUsed >= 75) warningLevel = 75;
  }

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    minutesThisPeriod: round1(minutesThisPeriod),
    minutesToday: round1(secToday / 60),
    minutesThisWeek: round1(secThisWeek / 60),
    voiceoversThisPeriod: countThisPeriod,
    averageSeconds: Math.round(averageSeconds),
    monthlyMinuteBudget: hasBudget ? budget! : null,
    percentUsed,
    minutesRemaining: minutesRemaining != null ? round1(minutesRemaining) : null,
    estimatedVideosRemainingAtAverage: estAtAvg,
    estimatedVideosRemainingAt30s: estAt30,
    billingResetDate: hasBudget || config.billingResetDay ? end.toISOString() : null,
    warningLevel,
  };
}

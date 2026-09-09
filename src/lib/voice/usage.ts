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
  hardCapMinutes?: number | null; // optional operator spend guard (blocks generation when exceeded)
}

/** Where each effective config value came from — for honest operator display. */
export interface VoiceConfigSource {
  monthlyMinuteBudget: "operator" | "env" | "unset";
  billingResetDay: "operator" | "env" | "unset";
  hardCapMinutes: "operator" | "env" | "unset";
}

function envNum(env: NodeJS.ProcessEnv, key: string): number | null {
  const raw = (env[key] ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve the EFFECTIVE usage config: an explicit operator (stored) value OVERRIDES the
 * environment default; env provides the initial value; otherwise unset. Pure — env is
 * injected. Reports the source of each field so the dashboard can show provenance
 * without ever fabricating a plan value.
 */
export function resolveVoiceUsageConfig(
  stored: { monthlyMinuteBudget: number | null; billingResetDay: number | null; hardCapMinutes: number | null },
  env: NodeJS.ProcessEnv = process.env,
): { config: VoiceUsageConfig; source: VoiceConfigSource } {
  const envBudget = envNum(env, "ELEVENLABS_MONTHLY_MINUTE_BUDGET");
  const envReset = envNum(env, "ELEVENLABS_BILLING_RESET_DAY");
  const envCap = envNum(env, "ELEVENLABS_HARD_CAP_MINUTES");

  const pick = <T,>(operator: T | null, envVal: T | null): { value: T | null; src: "operator" | "env" | "unset" } =>
    operator != null ? { value: operator, src: "operator" } : envVal != null ? { value: envVal, src: "env" } : { value: null, src: "unset" };

  const budget = pick(stored.monthlyMinuteBudget, envBudget);
  const reset = pick(stored.billingResetDay, envReset);
  const cap = pick(stored.hardCapMinutes, envCap);

  return {
    config: { monthlyMinuteBudget: budget.value, billingResetDay: reset.value, hardCapMinutes: cap.value },
    source: { monthlyMinuteBudget: budget.src, billingResetDay: reset.src, hardCapMinutes: cap.src },
  };
}

export interface VoiceUsage {
  periodStart: string;
  periodEnd: string; // the reset boundary (next occurrence)
  minutesThisPeriod: number;
  minutesToday: number;
  minutesThisWeek: number;
  voiceoversThisPeriod: number;
  averageSeconds: number;
  /** How many of this period's counted voiceovers used a MEASURED (ffprobe) duration… */
  measuredThisPeriod: number;
  /** …versus a text ESTIMATE fallback (meter honesty — durations partly estimated). */
  estimatedThisPeriod: number;
  monthlyMinuteBudget: number | null;
  percentUsed: number | null; // null when no budget configured
  minutesRemaining: number | null; // null when no budget configured
  estimatedVideosRemainingAtAverage: number | null;
  estimatedVideosRemainingAt30s: number | null;
  billingResetDate: string | null;
  warningLevel: 0 | 75 | 90 | 100; // informational threshold crossed
  /** Optional operator hard cap (minutes) + whether this period has reached it. */
  hardCapMinutes: number | null;
  hardCapReached: boolean;
  /** True when NO allowance/reset is configured → remaining quota cannot be computed. */
  quotaUnknown: boolean;
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
  let measuredThisPeriod = 0;
  let estimatedThisPeriod = 0;
  let secAllForAvg = 0;
  let countAllForAvg = 0;

  for (const r of ready) {
    // Prefer the MEASURED (ffprobe) duration; a record's durationSeconds already holds
    // the measured value when available and the text estimate otherwise.
    const sec = r.durationSeconds ?? 0;
    const created = new Date(r.createdAt);
    secAllForAvg += sec;
    countAllForAvg += 1;
    if (created >= start && created < end) {
      secThisPeriod += sec;
      countThisPeriod += 1;
      // A record persisted before durationSource existed is treated as measured-unknown →
      // counted as measured so we never over-warn about estimates on legacy records.
      if (r.durationSource === "estimated") estimatedThisPeriod += 1;
      else measuredThisPeriod += 1;
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

  const hardCap = typeof config.hardCapMinutes === "number" && config.hardCapMinutes > 0 ? config.hardCapMinutes : null;
  const hardCapReached = hardCap != null && minutesThisPeriod >= hardCap;

  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    minutesThisPeriod: round1(minutesThisPeriod),
    minutesToday: round1(secToday / 60),
    minutesThisWeek: round1(secThisWeek / 60),
    voiceoversThisPeriod: countThisPeriod,
    averageSeconds: Math.round(averageSeconds),
    measuredThisPeriod,
    estimatedThisPeriod,
    monthlyMinuteBudget: hasBudget ? budget! : null,
    percentUsed,
    minutesRemaining: minutesRemaining != null ? round1(minutesRemaining) : null,
    estimatedVideosRemainingAtAverage: estAtAvg,
    estimatedVideosRemainingAt30s: estAt30,
    billingResetDate: hasBudget || config.billingResetDay ? end.toISOString() : null,
    warningLevel,
    hardCapMinutes: hardCap,
    hardCapReached,
    quotaUnknown: !hasBudget,
  };
}

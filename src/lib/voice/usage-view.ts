// ─────────────────────────────────────────────────────────────────────────────
// VOICE USAGE — PRESENTER. A pure function that turns a VoiceUsage (the computed
// numbers) + VoiceConfigSource (where each configured value came from) into an
// operator-facing view model of human-formatted strings. No React, no I/O, no
// network — every field the capacity-meter mandate requires is formatted here so
// the component and the API return the SAME honest wording.
//
// HONESTY RULES (mirroring computeVoiceUsage):
//   • Never fabricate a plan value. When no allowance is configured, remaining
//     quota "cannot yet be calculated" — we say so instead of inventing a number.
//   • Always disclose the SOURCE of each configured value (operator vs env vs unset).
//   • Disclose whether durations are EXACT (all measured) or PARTLY ESTIMATED.
//   • Warnings (75/90/100) are informational; the optional hard cap BLOCKS.
// ─────────────────────────────────────────────────────────────────────────────
import type { VoiceUsage, VoiceConfigSource } from "./usage";

/** The provenance of a single configured value, ready to render. */
export type ConfigSource = "operator" | "env" | "unset";

export interface ConfigSourceView {
  source: ConfigSource;
  /** A short human label — "Set by operator" / "From environment default" / "Not configured". */
  label: string;
}

export interface VoiceUsageView {
  // ── Headline (billing period) ───────────────────────────────────────────────
  minutesThisPeriod: string; // "12.5 min"
  monthlyAllowance: string; // "60 min" OR "not configured"
  allowanceConfigured: boolean;
  percentUsed: string; // "42%" OR "—"
  percentUsedValue: number | null; // raw, for the progress bar
  minutesRemaining: string; // "47.5 min" OR "cannot yet be calculated"

  // ── Recent activity ─────────────────────────────────────────────────────────
  minutesToday: string; // "3.2 min"
  minutesThisWeek: string; // "8.9 min"
  voiceoversThisPeriod: string; // "14 voiceovers"
  averageDuration: string; // "38s" (avg per voiceover)

  // ── Capacity estimates (only meaningful with an allowance) ──────────────────
  estimatedVideosRemainingAtAverage: string; // "74 videos" OR "—"
  estimatedVideosRemainingAt30s: string; // "95 videos" OR "—"

  // ── Billing cycle ────────────────────────────────────────────────────────────
  billingResetDate: string; // "Sep 15, 2026" OR "—"

  // ── Warning state (informational) ────────────────────────────────────────────
  warningLevel: 0 | 75 | 90 | 100;
  warningLabel: string | null; // null when below 75%

  // ── Hard cap (blocking spend guard) ──────────────────────────────────────────
  hardCapConfigured: boolean;
  hardCap: string; // "90 min" OR "not configured"
  hardCapReached: boolean;
  hardCapMessage: string | null; // set only when reached

  // ── Quota-unknown honesty ────────────────────────────────────────────────────
  quotaUnknown: boolean;
  quotaUnknownMessage: string | null; // the "cannot yet be calculated" explanation

  // ── Duration accuracy disclosure ─────────────────────────────────────────────
  durationsExact: boolean; // true when every counted voiceover used a measured duration
  durationAccuracyNote: string; // "Durations exact." OR "N of M durations are estimated."

  // ── Provenance of each configured value ──────────────────────────────────────
  source: {
    monthlyMinuteBudget: ConfigSourceView;
    billingResetDay: ConfigSourceView;
    hardCapMinutes: ConfigSourceView;
  };
}

const NOT_CONFIGURED = "not configured";
const CANNOT_CALC = "cannot yet be calculated";

function fmtMinutes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n} min`;
}

function fmtSeconds(n: number): string {
  return `${Math.round(n)}s`;
}

function fmtCount(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function sourceView(source: ConfigSource): ConfigSourceView {
  switch (source) {
    case "operator":
      return { source, label: "Set by operator" };
    case "env":
      return { source, label: "From environment default" };
    case "unset":
    default:
      return { source: "unset", label: "Not configured" };
  }
}

function warningLabel(level: 0 | 75 | 90 | 100): string | null {
  switch (level) {
    case 100:
      return "Monthly allowance reached — generation still works and may exceed your plan.";
    case 90:
      return "90% of the monthly allowance used.";
    case 75:
      return "75% of the monthly allowance used.";
    default:
      return null;
  }
}

/**
 * Turn the computed usage + config provenance into an operator-facing view model.
 * Pure and deterministic — the SAME model backs both the API response and the React
 * meter, so the wording can never drift between them.
 */
export function buildVoiceUsageView(usage: VoiceUsage, source: VoiceConfigSource): VoiceUsageView {
  const allowanceConfigured = usage.monthlyMinuteBudget != null && usage.monthlyMinuteBudget > 0;
  const hardCapConfigured = usage.hardCapMinutes != null && usage.hardCapMinutes > 0;

  const estimated = usage.estimatedThisPeriod;
  const measured = usage.measuredThisPeriod;
  const total = estimated + measured;
  const durationsExact = estimated === 0;
  const durationAccuracyNote =
    total === 0
      ? "No voiceovers this period."
      : durationsExact
        ? "Durations are exact (measured from the generated audio)."
        : `${estimated} of ${total} durations this period are estimated; the rest are measured.`;

  return {
    minutesThisPeriod: fmtMinutes(usage.minutesThisPeriod),
    monthlyAllowance: allowanceConfigured ? fmtMinutes(usage.monthlyMinuteBudget) : NOT_CONFIGURED,
    allowanceConfigured,
    percentUsed: usage.percentUsed == null ? "—" : `${usage.percentUsed}%`,
    percentUsedValue: usage.percentUsed,
    minutesRemaining: usage.minutesRemaining == null ? CANNOT_CALC : fmtMinutes(usage.minutesRemaining),

    minutesToday: fmtMinutes(usage.minutesToday),
    minutesThisWeek: fmtMinutes(usage.minutesThisWeek),
    voiceoversThisPeriod: fmtCount(usage.voiceoversThisPeriod, "voiceover"),
    averageDuration: fmtSeconds(usage.averageSeconds),

    estimatedVideosRemainingAtAverage:
      usage.estimatedVideosRemainingAtAverage == null ? "—" : fmtCount(usage.estimatedVideosRemainingAtAverage, "video"),
    estimatedVideosRemainingAt30s:
      usage.estimatedVideosRemainingAt30s == null ? "—" : fmtCount(usage.estimatedVideosRemainingAt30s, "video"),

    billingResetDate: fmtDate(usage.billingResetDate),

    warningLevel: usage.warningLevel,
    warningLabel: warningLabel(usage.warningLevel),

    hardCapConfigured,
    hardCap: hardCapConfigured ? fmtMinutes(usage.hardCapMinutes) : NOT_CONFIGURED,
    hardCapReached: usage.hardCapReached,
    hardCapMessage: usage.hardCapReached
      ? "Hard cap reached — voice generation is blocked until the cap is raised or the period resets."
      : null,

    quotaUnknown: usage.quotaUnknown,
    quotaUnknownMessage: usage.quotaUnknown
      ? "Remaining quota cannot yet be calculated — no monthly allowance is configured. Only actual usage is shown."
      : null,

    durationsExact,
    durationAccuracyNote,

    source: {
      monthlyMinuteBudget: sourceView(source.monthlyMinuteBudget),
      billingResetDay: sourceView(source.billingResetDay),
      hardCapMinutes: sourceView(source.hardCapMinutes),
    },
  };
}

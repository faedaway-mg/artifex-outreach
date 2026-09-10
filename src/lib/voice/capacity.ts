// ─────────────────────────────────────────────────────────────────────────────
// ELEVENLABS VOICE CAPACITY MANAGER (mandate C). PURE.
//
// A shared capacity view over the ONE existing voice usage meter (usage.ts) + cost
// ledger, used by BOTH Acquisition prospect production and Content Studio social
// production while keeping their lineage/scopes separate. It answers the operator's
// real question before pressing Generate:
//
//   "How much voice capacity can I safely spend on social videos WITHOUT jeopardizing
//    upcoming lead production?"
//
// PRINCIPLES ENFORCED HERE (not just claimed):
//   • Never fabricate a plan limit. When the allowance/provider balance is unknown we
//     say so — measured usage is still reported, remaining/available are null.
//   • Acquisition has priority: a forecast-based reserve protects the revenue pipeline;
//     social discretionary = remaining − reserve, floored at 0.
//   • Trust-video REUSE is zero new TTS — the reserve forecasts only the personalized
//     prospect narration actually expected, never one new trust narration per prospect.
//   • Reserve reacts to the real pipeline (finalists sized to near-term send capacity),
//     not theoretical discovery volume. Insufficient data → a labelled conservative
//     fallback, never fake precision.
//   • #202 (qualification/authorization) is SEPARATE and unchanged; this is throughput.
//
// No I/O — inputs are injected. The store/assembler (capacity-store.ts) gathers the
// live signals; this module is deterministic + unit-testable.
// ─────────────────────────────────────────────────────────────────────────────
import type { VoiceUsage } from "./usage";

/** Optional real provider (ElevenLabs) subscription balance. Null when unavailable. */
export interface ProviderBalance {
  /** Characters remaining this provider cycle (limit − used). */
  charactersRemaining: number | null;
  charactersLimit: number | null;
  /** Provider cycle reset (ISO), when known. */
  resetAt: string | null;
  /** Minutes remaining derived from characters at the current model rate, when derivable. */
  minutesRemaining: number | null;
}

/** The live acquisition-pipeline signals that shape the forecast reserve. */
export interface AcquisitionDemandSignals {
  /** Ranked finalists meeting the Production Confidence contract (near-term producible). */
  finalistsMeetingContract: number;
  /** Offers already APPROVED_NOT_SENT (their voice is already generated → not new demand). */
  readyToSendInventory: number;
  /** Combined effective daily SEND capacity across warmed lanes (mailbox ramp). */
  combinedDailyCapacity: number;
  /** Average MEASURED prospect personalized-narration seconds (0 ⇒ unknown → fallback). */
  avgProspectNarrationSeconds: number;
}

/** Operator/env reserve knobs — a conservative fallback used only when data is thin. */
export interface ReserveConfig {
  /** Minutes to protect for Acquisition when the pipeline can't be forecast. */
  fallbackReserveMinutes: number;
  /** Average prospect narration minutes to assume when no measured data exists. */
  fallbackProspectMinutes: number;
  /** How many days ahead to forecast producible demand (mailbox-ramp horizon). */
  horizonDays: number;
}

export const DEFAULT_RESERVE_CONFIG: ReserveConfig = {
  fallbackReserveMinutes: 30,
  fallbackProspectMinutes: 0.5,
  horizonDays: 14,
};

export type ReserveBasis = "forecast" | "fallback";

export interface AcquisitionReserve {
  minutes: number;
  basis: ReserveBasis;
  /** Human-readable, honest explanation of how the reserve was derived. */
  detail: string;
  /** The expected number of NEW personalized prospect narrations behind the reserve. */
  forecastPackages: number;
}

export type CapacityStatus =
  | "HEALTHY"
  | "CAUTION"
  | "ACQUISITION_RESERVED"
  | "LOW_PROVIDER_CAPACITY"
  | "UNKNOWN";

export interface VoiceCapacity {
  // Allowance / usage (minutes) — the honest, non-fabricated core.
  allowanceMinutes: number | null;
  usedMinutes: number;
  remainingMinutes: number | null;   // null ⇒ no allowance/provider balance known
  quotaUnknown: boolean;

  // Billing cycle.
  resetDate: string | null;
  daysUntilReset: number | null;

  // The protected Acquisition pool + the safe Social discretionary balance.
  acquisitionReserve: AcquisitionReserve;
  socialAvailableMinutes: number | null; // remaining − reserve, floored at 0; null if unknown

  // Forecast estimates (labelled Estimated in the UI).
  averageSocialSeconds: number;
  estimatedSocialVideos: number | null;      // socialAvailable ÷ average social duration
  estimatedProspectNarrations: number | null; // reserve ÷ average prospect duration

  // Optional real provider balance (credits/characters) — shown when available.
  provider: ProviderBalance | null;

  status: CapacityStatus;
  /** Provenance of the allowance figure for honest display. */
  allowanceSource: "operator" | "env" | "provider" | "unset";
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

function daysBetween(fromIso: string, toIso: string | null): number | null {
  if (!toIso) return null;
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
}

/**
 * Forecast the Acquisition voice reserve from the real pipeline. The reserve is the
 * personalized prospect narration we plausibly expect to GENERATE before the cycle
 * resets — bounded by what the mailbox ramp can actually send in the horizon (so we
 * never reserve for packages that cannot be used soon), and by the finalists that meet
 * the Production Confidence contract. Trust-video reuse contributes ZERO (only new
 * personalized narration is forecast). Thin data → a labelled conservative fallback.
 * PURE.
 */
export function forecastAcquisitionReserve(
  signals: AcquisitionDemandSignals,
  daysUntilReset: number | null,
  cfg: ReserveConfig = DEFAULT_RESERVE_CONFIG,
): AcquisitionReserve {
  const horizon = daysUntilReset == null ? cfg.horizonDays : Math.min(daysUntilReset, cfg.horizonDays);
  const sendableInHorizon = Math.max(0, Math.round((signals.combinedDailyCapacity || 0) * horizon));

  // New personalized voice is needed for producible finalists NOT already voiced (the
  // ready-to-send inventory is already generated → excluded). Bounded by what can ship.
  const producibleFinalists = Math.max(0, signals.finalistsMeetingContract || 0);
  const dataThin = producibleFinalists === 0 && sendableInHorizon === 0;

  if (dataThin) {
    return {
      minutes: round1(Math.max(0, cfg.fallbackReserveMinutes)),
      basis: "fallback",
      detail: `Conservative fallback reserve (${round1(cfg.fallbackReserveMinutes)} min) — not enough live pipeline signal (finalists / mailbox capacity) to forecast demand.`,
      forecastPackages: Math.max(0, Math.round(cfg.fallbackReserveMinutes / Math.max(0.01, cfg.fallbackProspectMinutes))),
    };
  }

  // Expected NEW personalized narrations = producible finalists, capped by shippable capacity.
  const forecastPackages = Math.min(producibleFinalists, sendableInHorizon || producibleFinalists);
  const perProspectMin = signals.avgProspectNarrationSeconds > 0
    ? signals.avgProspectNarrationSeconds / 60
    : cfg.fallbackProspectMinutes;
  const minutes = round1(forecastPackages * perProspectMin);
  const durLabel = signals.avgProspectNarrationSeconds > 0
    ? `${round1(signals.avgProspectNarrationSeconds)}s measured avg`
    : `${cfg.fallbackProspectMinutes}min assumed`;

  return {
    minutes,
    basis: "forecast",
    detail: `~${forecastPackages} producible prospect narration(s) × ${durLabel}, bounded by ${sendableInHorizon || "∞"} shippable over ${horizon}d. Trust-video reuse excluded (0 new TTS).`,
    forecastPackages,
  };
}

export interface ComputeCapacityInput {
  usage: VoiceUsage;
  allowanceSource: VoiceCapacity["allowanceSource"];
  reserve: AcquisitionReserve;
  provider?: ProviderBalance | null;
  /** Average social Field Note narration seconds (0 ⇒ fall back to the meter average). */
  averageSocialSeconds?: number;
  nowIso: string;
  /** Fraction of allowance below which social available reads as CAUTION. */
  cautionFraction?: number;
}

const DEFAULT_CAUTION_FRACTION = 0.15;

/**
 * Assemble the shared VoiceCapacity view. Deterministic. Never fabricates: when the
 * meter reports no allowance AND there is no provider balance, remaining/available are
 * null and the status is UNKNOWN (measured usage is still shown). PURE.
 */
export function computeVoiceCapacity(input: ComputeCapacityInput): VoiceCapacity {
  const { usage, reserve } = input;
  const usedMinutes = usage.minutesThisPeriod;

  // Remaining prefers the configured allowance; else a derivable provider balance.
  const remainingFromBudget = usage.minutesRemaining;
  const remainingFromProvider = input.provider?.minutesRemaining ?? null;
  const remainingMinutes = remainingFromBudget != null ? remainingFromBudget
    : remainingFromProvider != null ? round1(remainingFromProvider)
    : null;

  const allowanceMinutes = usage.monthlyMinuteBudget;
  const resetDate = usage.billingResetDate ?? input.provider?.resetAt ?? null;
  const daysUntilReset = daysBetween(input.nowIso, resetDate);

  const socialAvailableMinutes = remainingMinutes != null
    ? round1(Math.max(0, remainingMinutes - reserve.minutes))
    : null;

  const averageSocialSeconds = input.averageSocialSeconds && input.averageSocialSeconds > 0
    ? input.averageSocialSeconds
    : usage.averageSeconds > 0 ? usage.averageSeconds : 30;
  const perProspectSeconds = reserve.forecastPackages > 0 && reserve.minutes > 0
    ? (reserve.minutes * 60) / reserve.forecastPackages
    : usage.averageSeconds > 0 ? usage.averageSeconds : 30;

  const estimatedSocialVideos = socialAvailableMinutes != null
    ? Math.floor((socialAvailableMinutes * 60) / averageSocialSeconds)
    : null;
  const estimatedProspectNarrations = remainingMinutes != null
    ? Math.floor((reserve.minutes * 60) / Math.max(1, perProspectSeconds))
    : null;

  // Status. UNKNOWN when nothing to divide against; otherwise ordered by severity.
  let status: CapacityStatus;
  const cautionFraction = input.cautionFraction ?? DEFAULT_CAUTION_FRACTION;
  if (remainingMinutes == null) {
    status = "UNKNOWN";
  } else if (remainingMinutes < reserve.minutes) {
    status = "LOW_PROVIDER_CAPACITY"; // even the Acquisition forecast may exceed what remains
  } else if ((socialAvailableMinutes ?? 0) <= 0) {
    status = "ACQUISITION_RESERVED"; // all safe discretionary capacity consumed
  } else if (allowanceMinutes != null && (socialAvailableMinutes ?? 0) < allowanceMinutes * cautionFraction) {
    status = "CAUTION"; // approaching the protected reserve
  } else {
    status = "HEALTHY";
  }

  return {
    allowanceMinutes,
    usedMinutes,
    remainingMinutes,
    quotaUnknown: remainingMinutes == null,
    resetDate,
    daysUntilReset,
    acquisitionReserve: reserve,
    socialAvailableMinutes,
    averageSocialSeconds: Math.round(averageSocialSeconds),
    estimatedSocialVideos,
    estimatedProspectNarrations,
    provider: input.provider ?? null,
    status,
    allowanceSource: input.allowanceSource,
  };
}

// ── Per-generation forecast + the safe-to-generate policy ──────────────────────
export interface GenerationForecast {
  estMinutes: number;
  socialAvailableBefore: number | null;
  socialAvailableAfter: number | null;
  /** True when this generation would dip into the protected Acquisition reserve. */
  crossesReserve: boolean;
  /** Whether the capacity is unknown (no allowance/provider balance). */
  unknown: boolean;
}

/** Estimated minutes for a social video of `targetSeconds` (rounded to 0.1). */
export function estimatedSocialMinutes(targetSeconds: number): number {
  return round1(Math.max(0, targetSeconds) / 60);
}

/** Forecast the effect of ONE social generation on the discretionary balance. PURE. */
export function forecastGeneration(capacity: VoiceCapacity, targetSeconds: number): GenerationForecast {
  const estMinutes = estimatedSocialMinutes(targetSeconds);
  const before = capacity.socialAvailableMinutes;
  const after = before != null ? round1(before - estMinutes) : null;
  return {
    estMinutes,
    socialAvailableBefore: before,
    socialAvailableAfter: after,
    crossesReserve: after != null ? after < 0 : false,
    unknown: capacity.remainingMinutes == null,
  };
}

export interface GeneratePolicy {
  allowed: boolean;
  /** True when the operator must explicitly override to proceed (reserve boundary). */
  requiresOverride: boolean;
  reason: string;
}

/**
 * The social-generation policy (mandate §7). HEALTHY/CAUTION proceed. When a generation
 * would consume protected Acquisition capacity it does NOT silently proceed — it needs an
 * explicit single-generation override ("Generate Anyway"). Unknown capacity proceeds
 * (we never fabricate a limit to block on), but the caller shows the honest unknown.
 * PURE.
 */
export function socialGeneratePolicy(capacity: VoiceCapacity, targetSeconds: number, override = false): GeneratePolicy {
  const f = forecastGeneration(capacity, targetSeconds);
  if (f.unknown) {
    return { allowed: true, requiresOverride: false, reason: "Provider capacity is unknown — generation proceeds; usage is metered and shown honestly." };
  }
  if (f.crossesReserve) {
    if (override) {
      return { allowed: true, requiresOverride: true, reason: "Operator override: this single social generation uses capacity reserved for upcoming prospect packages." };
    }
    return {
      allowed: false,
      requiresOverride: true,
      reason: "This generation would use voice capacity currently reserved for upcoming prospect packages. Keep Reserve, or explicitly Generate Anyway.",
    };
  }
  return { allowed: true, requiresOverride: false, reason: "Enough discretionary social capacity remains." };
}

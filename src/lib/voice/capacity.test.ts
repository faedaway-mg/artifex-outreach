import { describe, it, expect } from "vitest";
import {
  forecastAcquisitionReserve,
  computeVoiceCapacity,
  forecastGeneration,
  socialGeneratePolicy,
  estimatedSocialMinutes,
  DEFAULT_RESERVE_CONFIG,
  type AcquisitionReserve,
} from "./capacity";
import type { VoiceUsage } from "./usage";
import { normalizeSubscription } from "./provider-balance";

// A usage meter fixture; override per test.
function usage(over: Partial<VoiceUsage> = {}): VoiceUsage {
  return {
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-10-01T00:00:00.000Z",
    minutesThisPeriod: 71,
    minutesToday: 3,
    minutesThisWeek: 20,
    voiceoversThisPeriod: 40,
    averageSeconds: 30,
    measuredThisPeriod: 40,
    estimatedThisPeriod: 0,
    monthlyMinuteBudget: 220,
    percentUsed: 32,
    minutesRemaining: 149,
    estimatedVideosRemainingAtAverage: 298,
    estimatedVideosRemainingAt30s: 298,
    billingResetDate: "2026-10-01T00:00:00.000Z",
    warningLevel: 0,
    hardCapMinutes: null,
    hardCapReached: false,
    quotaUnknown: false,
    ...over,
  };
}

const NOW = "2026-09-10T00:00:00.000Z"; // 21 days to reset

describe("forecastAcquisitionReserve (mandate C §4/§5/§16)", () => {
  it("forecasts from the real pipeline, bounded by shippable capacity; trust reuse excluded", () => {
    // 10 finalists, capacity 5/day, horizon min(21,14)=14 → 70 shippable → not the binding cap.
    const r = forecastAcquisitionReserve(
      { finalistsMeetingContract: 10, readyToSendInventory: 3, combinedDailyCapacity: 5, avgProspectNarrationSeconds: 42 },
      21,
    );
    expect(r.basis).toBe("forecast");
    expect(r.forecastPackages).toBe(10); // finalists, since shippable(70) ≥ finalists
    expect(r.minutes).toBeCloseTo(10 * (42 / 60), 1); // 7.0 min
    expect(r.detail).toMatch(/reuse excluded/i);
  });

  it("caps the reserve by what the mailbox ramp can actually send in the horizon", () => {
    // Many finalists but only 1/day for 14d → 14 shippable binds below 50 finalists.
    const r = forecastAcquisitionReserve(
      { finalistsMeetingContract: 50, readyToSendInventory: 0, combinedDailyCapacity: 1, avgProspectNarrationSeconds: 60 },
      30,
    );
    expect(r.forecastPackages).toBe(14);
    expect(r.minutes).toBeCloseTo(14, 1);
  });

  it("uses a LABELLED conservative fallback when pipeline signal is too thin", () => {
    const r = forecastAcquisitionReserve(
      { finalistsMeetingContract: 0, readyToSendInventory: 0, combinedDailyCapacity: 0, avgProspectNarrationSeconds: 0 },
      21,
    );
    expect(r.basis).toBe("fallback");
    expect(r.minutes).toBe(DEFAULT_RESERVE_CONFIG.fallbackReserveMinutes);
    expect(r.detail).toMatch(/fallback/i);
  });
});

function reserve(min: number, basis: "forecast" | "fallback" = "forecast", packages = 10): AcquisitionReserve {
  return { minutes: min, basis, detail: "x", forecastPackages: packages };
}

describe("computeVoiceCapacity — honest allowance + status (mandate C §1/§6)", () => {
  it("HEALTHY: ample discretionary social after the reserve", () => {
    const c = computeVoiceCapacity({ usage: usage(), allowanceSource: "operator", reserve: reserve(95), nowIso: NOW });
    expect(c.remainingMinutes).toBe(149);
    expect(c.socialAvailableMinutes).toBe(54); // 149 − 95
    expect(c.status).toBe("HEALTHY");
    expect(c.estimatedSocialVideos).toBe(Math.floor((54 * 60) / 30));
    expect(c.daysUntilReset).toBe(21);
  });

  it("ACQUISITION_RESERVED: remaining equals the reserve → no safe discretionary left", () => {
    const c = computeVoiceCapacity({ usage: usage({ minutesRemaining: 95 }), allowanceSource: "operator", reserve: reserve(95), nowIso: NOW });
    expect(c.socialAvailableMinutes).toBe(0);
    expect(c.status).toBe("ACQUISITION_RESERVED");
  });

  it("LOW_PROVIDER_CAPACITY: even the Acquisition forecast exceeds what remains", () => {
    const c = computeVoiceCapacity({ usage: usage({ minutesRemaining: 40 }), allowanceSource: "operator", reserve: reserve(95), nowIso: NOW });
    expect(c.status).toBe("LOW_PROVIDER_CAPACITY");
    expect(c.socialAvailableMinutes).toBe(0);
  });

  it("CAUTION: discretionary social is a thin slice of the allowance", () => {
    // allowance 220, reserve 120, remaining 140 → social 20 (< 15% of 220 = 33) → CAUTION
    const c = computeVoiceCapacity({ usage: usage({ minutesRemaining: 140 }), allowanceSource: "operator", reserve: reserve(120), nowIso: NOW });
    expect(c.socialAvailableMinutes).toBe(20);
    expect(c.status).toBe("CAUTION");
  });

  it("UNKNOWN: no allowance and no provider balance → never fabricates a limit", () => {
    const c = computeVoiceCapacity({
      usage: usage({ monthlyMinuteBudget: null, minutesRemaining: null, quotaUnknown: true, billingResetDate: null }),
      allowanceSource: "unset",
      reserve: reserve(30, "fallback"),
      nowIso: NOW,
    });
    expect(c.remainingMinutes).toBeNull();
    expect(c.socialAvailableMinutes).toBeNull();
    expect(c.quotaUnknown).toBe(true);
    expect(c.status).toBe("UNKNOWN");
    expect(c.usedMinutes).toBe(71); // measured usage is STILL reported honestly
  });

  it("derives remaining from the provider balance when no operator/env allowance is set", () => {
    const c = computeVoiceCapacity({
      usage: usage({ monthlyMinuteBudget: null, minutesRemaining: null, quotaUnknown: true, billingResetDate: null }),
      allowanceSource: "provider",
      reserve: reserve(20),
      provider: { charactersRemaining: 90000, charactersLimit: 100000, resetAt: "2026-10-01T00:00:00.000Z", minutesRemaining: 100 },
      nowIso: NOW,
    });
    expect(c.remainingMinutes).toBe(100);
    expect(c.socialAvailableMinutes).toBe(80);
    expect(c.status).toBe("HEALTHY");
  });
});

describe("per-generation forecast + policy (mandate C §7/§17)", () => {
  const healthy = () => computeVoiceCapacity({ usage: usage(), allowanceSource: "operator", reserve: reserve(95), nowIso: NOW });

  it("forecasts the after-balance and never mutates capacity", () => {
    const f = forecastGeneration(healthy(), 30);
    expect(f.estMinutes).toBe(0.5);
    expect(f.socialAvailableBefore).toBe(54);
    expect(f.socialAvailableAfter).toBe(53.5);
    expect(f.crossesReserve).toBe(false);
  });

  it("BLOCKS a generation that would cross the reserve; an explicit override authorizes ONE", () => {
    const c = computeVoiceCapacity({ usage: usage({ minutesRemaining: 95.2 }), allowanceSource: "operator", reserve: reserve(95), nowIso: NOW });
    // social available 0.2 min; a 30s (0.5 min) gen would go negative → crosses reserve
    const blocked = socialGeneratePolicy(c, 30, false);
    expect(blocked.allowed).toBe(false);
    expect(blocked.requiresOverride).toBe(true);
    const overridden = socialGeneratePolicy(c, 30, true);
    expect(overridden.allowed).toBe(true);
    expect(overridden.requiresOverride).toBe(true);
  });

  it("unknown capacity proceeds (never fabricate a limit to block on)", () => {
    const c = computeVoiceCapacity({
      usage: usage({ monthlyMinuteBudget: null, minutesRemaining: null, quotaUnknown: true }),
      allowanceSource: "unset", reserve: reserve(30, "fallback"), nowIso: NOW,
    });
    const p = socialGeneratePolicy(c, 30, false);
    expect(p.allowed).toBe(true);
    expect(p.requiresOverride).toBe(false);
  });

  it("estimatedSocialMinutes rounds to a tenth", () => {
    expect(estimatedSocialMinutes(31.8)).toBe(0.5);
    expect(estimatedSocialMinutes(90)).toBe(1.5);
  });
});

describe("provider balance normalization (fail-open, never fabricated)", () => {
  it("normalizes a real subscription payload", () => {
    const b = normalizeSubscription({ character_count: 10000, character_limit: 100000, next_character_count_reset_unix: 1790000000 });
    expect(b?.charactersRemaining).toBe(90000);
    expect(b?.charactersLimit).toBe(100000);
    expect(b?.resetAt).toMatch(/^20\d\d-/);
    expect(b?.minutesRemaining).toBeGreaterThan(0);
  });

  it("returns null (unavailable) rather than a fabricated zero when the payload is empty", () => {
    expect(normalizeSubscription({})).toBeNull();
    expect(normalizeSubscription(null)).toBeNull();
  });
});

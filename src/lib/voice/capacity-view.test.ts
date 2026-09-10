import { describe, it, expect } from "vitest";
import { capacityCardModel, capacityForecastModel, fmtMin } from "./capacity-view";
import { computeVoiceCapacity } from "./capacity";
import type { VoiceUsage } from "./usage";

function usage(over: Partial<VoiceUsage> = {}): VoiceUsage {
  return {
    periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z",
    minutesThisPeriod: 71, minutesToday: 3, minutesThisWeek: 20, voiceoversThisPeriod: 40, averageSeconds: 30,
    measuredThisPeriod: 40, estimatedThisPeriod: 0, monthlyMinuteBudget: 220, percentUsed: 32, minutesRemaining: 149,
    estimatedVideosRemainingAtAverage: 298, estimatedVideosRemainingAt30s: 298, billingResetDate: "2026-09-28T00:00:00.000Z",
    warningLevel: 0, hardCapMinutes: null, hardCapReached: false, quotaUnknown: false, ...over,
  };
}
const reserve = (min: number, basis: "forecast" | "fallback" = "forecast") => ({ minutes: min, basis, detail: "x", forecastPackages: 10 });
const NOW = "2026-09-10T00:00:00.000Z";

describe("capacity display models (mandate C §1/§2)", () => {
  it("renders the configured card with the mandate's shape", () => {
    const c = computeVoiceCapacity({ usage: usage(), allowanceSource: "operator", reserve: reserve(95), nowIso: NOW });
    const m = capacityCardModel(c);
    expect(m.allowance).toBe("220 min");
    expect(m.used).toBe("71 min");
    expect(m.remaining).toBe("149 min");
    expect(m.reserved).toBe("95 min");
    expect(m.available).toBe("54 min");
    expect(m.resets).toMatch(/^Sep 28/);
    expect(m.statusLabel).toBe("Healthy");
    expect(m.estimatedSocialVideos).toMatch(/^~\d+ × \d+s$/);
  });

  it("honest unknown: shows dashes + a clear note, never a fabricated number", () => {
    const c = computeVoiceCapacity({
      usage: usage({ monthlyMinuteBudget: null, minutesRemaining: null, quotaUnknown: true, billingResetDate: null }),
      allowanceSource: "unset", reserve: reserve(30, "fallback"), nowIso: NOW,
    });
    const m = capacityCardModel(c);
    expect(m.allowance).toBe("—");
    expect(m.remaining).toBe("—");
    expect(m.available).toBe("—");
    expect(m.unknownNote).toBeTruthy();
    expect(m.used).toBe("71 min"); // measured usage still shown
  });

  it("per-generation forecast summarizes the after-balance", () => {
    const c = computeVoiceCapacity({ usage: usage(), allowanceSource: "operator", reserve: reserve(95), nowIso: NOW });
    const f = capacityForecastModel(c, 30)!;
    expect(f.estUse).toBe("~0.5 min");
    expect(f.availableAfter).toBe("53.5 min");
    expect(f.crossesReserve).toBe(false);
    expect(f.summary).toMatch(/social left after/);
  });

  it("fmtMin never fabricates", () => {
    expect(fmtMin(null)).toBe("—");
    expect(fmtMin(12.34)).toBe("12.3 min");
  });
});

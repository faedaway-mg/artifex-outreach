// ─────────────────────────────────────────────────────────────────────────────
// VOICE USAGE — the shape the capacity meter renders from. These tests lock the
// view-facing contract of computeVoiceUsage: with NO budget there is NEVER a
// fabricated remaining quota (percentUsed / minutesRemaining / estimates are all
// null), and with a budget the informational warning thresholds (75/90/100) are
// crossed correctly. Pure function — no network, no real ElevenLabs call.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { computeVoiceUsage, resolveVoiceUsageConfig, type VoiceConfigSource, type VoiceUsage } from "./usage";
import { buildVoiceUsageView } from "./usage-view";
import type { VoiceoverRecord } from "./store";

const NOW = "2026-08-15T12:00:00.000Z";

// A minimal READY record with a chosen duration, created inside the current calendar
// period. Only the fields computeVoiceUsage reads need to be real.
function ready(
  id: string,
  durationSeconds: number,
  createdAt = "2026-08-10T00:00:00.000Z",
  durationSource: "measured" | "estimated" | null = "measured",
): VoiceoverRecord {
  return {
    id,
    leadId: "lead-1",
    company: null,
    offerId: null,
    narrationId: "n1",
    narrationRevision: "rev1",
    voiceKey: "artifex_default",
    provider: "elevenlabs",
    voiceId: "REDACTED",
    modelId: "m",
    outputFormat: "mp3",
    assetKey: `k/${id}`,
    assetBytes: 1000,
    assetSha256: "sha",
    characterCount: 100,
    durationSeconds,
    durationSource,
    requestId: null,
    status: "VOICEOVER_READY",
    failureReason: null,
    kind: "initial",
    createdAt,
    updatedAt: createdAt,
    supersedes: null,
    supersededBy: null,
  };
}

// Every field of a source defaults to "unset" unless overridden.
function src(over: Partial<VoiceConfigSource> = {}): VoiceConfigSource {
  return { monthlyMinuteBudget: "unset", billingResetDay: "unset", hardCapMinutes: "unset", ...over };
}

// Build the presenter view straight from records + config, with a chosen source.
function view(records: VoiceoverRecord[], config: Parameters<typeof computeVoiceUsage>[1], source: VoiceConfigSource, now = NOW) {
  const usage: VoiceUsage = computeVoiceUsage(records, config, now);
  return buildVoiceUsageView(usage, source);
}

describe("computeVoiceUsage — meter view contract", () => {
  it("with NO budget, never fabricates a remaining quota", () => {
    const u = computeVoiceUsage([ready("a", 60), ready("b", 30)], { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    expect(u.minutesThisPeriod).toBe(1.5); // 90s
    expect(u.voiceoversThisPeriod).toBe(2);
    expect(u.percentUsed).toBeNull();
    expect(u.minutesRemaining).toBeNull();
    expect(u.estimatedVideosRemainingAtAverage).toBeNull();
    expect(u.estimatedVideosRemainingAt30s).toBeNull();
    expect(u.warningLevel).toBe(0);
  });

  it("with a budget, computes percent, remaining and 30s estimate", () => {
    // 5 minutes used against a 10-minute budget → 50%, 5 remaining, 10 videos @30s.
    const u = computeVoiceUsage([ready("a", 300)], { monthlyMinuteBudget: 10, billingResetDay: null }, NOW);
    expect(u.percentUsed).toBe(50);
    expect(u.minutesRemaining).toBe(5);
    expect(u.estimatedVideosRemainingAt30s).toBe(10);
    expect(u.warningLevel).toBe(0);
  });

  it("crosses the 75/90/100 informational thresholds", () => {
    const at75 = computeVoiceUsage([ready("a", 450)], { monthlyMinuteBudget: 10, billingResetDay: null }, NOW); // 7.5m/10m
    expect(at75.warningLevel).toBe(75);

    const at90 = computeVoiceUsage([ready("a", 540)], { monthlyMinuteBudget: 10, billingResetDay: null }, NOW); // 9m/10m
    expect(at90.warningLevel).toBe(90);

    const at100 = computeVoiceUsage([ready("a", 660)], { monthlyMinuteBudget: 10, billingResetDay: null }, NOW); // 11m/10m → capped 100
    expect(at100.warningLevel).toBe(100);
    expect(at100.percentUsed).toBe(100);
    expect(at100.minutesRemaining).toBe(0);
  });

  it("ignores non-READY and zero-duration records as consumed capacity", () => {
    const failed = { ...ready("f", 120), status: "VOICEOVER_FAILED" as const };
    const zero = ready("z", 0);
    const u = computeVoiceUsage([failed, zero, ready("ok", 60)], { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    expect(u.minutesThisPeriod).toBe(1);
    expect(u.voiceoversThisPeriod).toBe(1);
  });
});

describe("buildVoiceUsageView — presenter", () => {
  it("formats every activity field into human strings", () => {
    const v = view([ready("a", 300), ready("b", 60)], { monthlyMinuteBudget: 60, billingResetDay: 1 }, src({ monthlyMinuteBudget: "operator", billingResetDay: "operator" }));
    expect(v.minutesThisPeriod).toBe("6 min"); // 360s
    expect(v.monthlyAllowance).toBe("60 min");
    expect(v.allowanceConfigured).toBe(true);
    expect(v.percentUsed).toBe("10%");
    expect(v.percentUsedValue).toBe(10);
    expect(v.minutesRemaining).toBe("54 min");
    expect(v.voiceoversThisPeriod).toBe("2 voiceovers");
    expect(v.averageDuration).toBe("180s");
    expect(v.minutesToday).toBe("0 min");
    expect(v.minutesThisWeek).toBe("6 min");
    expect(v.billingResetDate).not.toBe("—"); // a real reset date
  });

  it("singularizes a single voiceover / single video", () => {
    const v = view([ready("only", 30)], { monthlyMinuteBudget: 1, billingResetDay: null }, src({ monthlyMinuteBudget: "operator" }));
    expect(v.voiceoversThisPeriod).toBe("1 voiceover");
    // 0.5 min remaining → 30s → exactly 1 video at 30s each.
    expect(v.estimatedVideosRemainingAt30s).toBe("1 video");
  });

  it("quotaUnknown: says remaining cannot be calculated and shows no fabricated numbers", () => {
    const v = view([ready("a", 90)], { monthlyMinuteBudget: null, billingResetDay: null }, src());
    expect(v.quotaUnknown).toBe(true);
    expect(v.quotaUnknownMessage).toMatch(/cannot yet be calculated/i);
    expect(v.monthlyAllowance).toBe("not configured");
    expect(v.allowanceConfigured).toBe(false);
    expect(v.percentUsed).toBe("—");
    expect(v.percentUsedValue).toBeNull();
    expect(v.minutesRemaining).toBe("cannot yet be calculated");
    expect(v.estimatedVideosRemainingAtAverage).toBe("—");
    expect(v.estimatedVideosRemainingAt30s).toBe("—");
    // Real usage IS still shown.
    expect(v.minutesThisPeriod).toBe("1.5 min");
  });

  it("surfaces the 75 warning threshold with a label, none below it", () => {
    const at50 = view([ready("a", 300)], { monthlyMinuteBudget: 10, billingResetDay: null }, src({ monthlyMinuteBudget: "operator" }));
    expect(at50.warningLevel).toBe(0);
    expect(at50.warningLabel).toBeNull();

    const at75 = view([ready("a", 450)], { monthlyMinuteBudget: 10, billingResetDay: null }, src({ monthlyMinuteBudget: "operator" }));
    expect(at75.warningLevel).toBe(75);
    expect(at75.warningLabel).toMatch(/75%/);
  });

  it("surfaces the 90 warning threshold", () => {
    const at90 = view([ready("a", 540)], { monthlyMinuteBudget: 10, billingResetDay: null }, src({ monthlyMinuteBudget: "operator" }));
    expect(at90.warningLevel).toBe(90);
    expect(at90.warningLabel).toMatch(/90%/);
  });

  it("surfaces the 100 warning threshold with an over-allowance message", () => {
    const at100 = view([ready("a", 660)], { monthlyMinuteBudget: 10, billingResetDay: null }, src({ monthlyMinuteBudget: "operator" }));
    expect(at100.warningLevel).toBe(100);
    expect(at100.warningLabel).toMatch(/reached/i);
    expect(at100.warningLabel).toMatch(/may exceed/i);
  });

  it("displays the hard cap and its blocking message only when reached", () => {
    // Under the cap: shown but not reached, no block message.
    const under = view([ready("a", 60)], { monthlyMinuteBudget: null, billingResetDay: null, hardCapMinutes: 5 }, src({ hardCapMinutes: "operator" }));
    expect(under.hardCapConfigured).toBe(true);
    expect(under.hardCap).toBe("5 min");
    expect(under.hardCapReached).toBe(false);
    expect(under.hardCapMessage).toBeNull();

    // At/over the cap: reached, with a blocking message.
    const over = view([ready("a", 360)], { monthlyMinuteBudget: null, billingResetDay: null, hardCapMinutes: 5 }, src({ hardCapMinutes: "operator" }));
    expect(over.hardCapReached).toBe(true);
    expect(over.hardCapMessage).toMatch(/blocked/i);
  });

  it("hard cap 'not configured' when unset", () => {
    const v = view([ready("a", 60)], { monthlyMinuteBudget: null, billingResetDay: null }, src());
    expect(v.hardCapConfigured).toBe(false);
    expect(v.hardCap).toBe("not configured");
  });

  it("labels the source of each configured value (operator vs env vs unset)", () => {
    const v = view(
      [ready("a", 60)],
      { monthlyMinuteBudget: 60, billingResetDay: 1, hardCapMinutes: 90 },
      src({ monthlyMinuteBudget: "operator", billingResetDay: "env", hardCapMinutes: "unset" }),
    );
    expect(v.source.monthlyMinuteBudget).toEqual({ source: "operator", label: "Set by operator" });
    expect(v.source.billingResetDay).toEqual({ source: "env", label: "From environment default" });
    expect(v.source.hardCapMinutes).toEqual({ source: "unset", label: "Not configured" });
  });

  it("notes durations are EXACT when all measured", () => {
    const v = view([ready("a", 60, "2026-08-10T00:00:00.000Z", "measured"), ready("b", 90, "2026-08-11T00:00:00.000Z", "measured")], { monthlyMinuteBudget: null, billingResetDay: null }, src());
    expect(v.durationsExact).toBe(true);
    expect(v.durationAccuracyNote).toMatch(/exact/i);
  });

  it("notes durations are PARTLY ESTIMATED when some are estimates", () => {
    const v = view(
      [
        ready("a", 60, "2026-08-10T00:00:00.000Z", "measured"),
        ready("b", 90, "2026-08-11T00:00:00.000Z", "estimated"),
        ready("c", 90, "2026-08-12T00:00:00.000Z", "estimated"),
      ],
      { monthlyMinuteBudget: null, billingResetDay: null },
      src(),
    );
    expect(v.durationsExact).toBe(false);
    expect(v.durationAccuracyNote).toMatch(/2 of 3/);
    expect(v.durationAccuracyNote).toMatch(/estimated/i);
  });

  it("estimated-videos fields format with the correct unit when a budget exists", () => {
    // 5 min remaining of a 10-min budget, avg 300s → 1 video at avg; 10 videos at 30s.
    const v = view([ready("a", 300)], { monthlyMinuteBudget: 10, billingResetDay: null }, src({ monthlyMinuteBudget: "operator" }));
    expect(v.estimatedVideosRemainingAtAverage).toBe("1 video");
    expect(v.estimatedVideosRemainingAt30s).toBe("10 videos");
  });
});

describe("resolveVoiceUsageConfig — operator overrides env (source provenance)", () => {
  it("operator stored value wins over env; unset falls through to unset", () => {
    const { config, source } = resolveVoiceUsageConfig(
      { monthlyMinuteBudget: 60, billingResetDay: null, hardCapMinutes: null },
      { ELEVENLABS_MONTHLY_MINUTE_BUDGET: "30", ELEVENLABS_BILLING_RESET_DAY: "15" } as unknown as NodeJS.ProcessEnv,
    );
    expect(config.monthlyMinuteBudget).toBe(60);
    expect(source.monthlyMinuteBudget).toBe("operator");
    expect(config.billingResetDay).toBe(15);
    expect(source.billingResetDay).toBe("env");
    expect(config.hardCapMinutes).toBeNull();
    expect(source.hardCapMinutes).toBe("unset");
  });
});

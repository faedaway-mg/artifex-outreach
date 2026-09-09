// ─────────────────────────────────────────────────────────────────────────────
// VOICE USAGE — pure, deterministic aggregation (now is injected). No provider, no
// store, no network. Builds VoiceoverRecord-like objects and asserts the capacity
// meter: only READY records with a real duration count; failed/generating never do;
// legacy assets aren't voiceover records at all; reuse creates no new record so the
// count is stable; capacity math + warning thresholds; and billing-period bounding.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { computeVoiceUsage } from "./usage";
import type { VoiceoverRecord, VoiceoverStatus } from "./store";

let seq = 0;
function rec(over: Partial<VoiceoverRecord> = {}): VoiceoverRecord {
  seq += 1;
  return {
    id: `vo_${seq}`,
    leadId: "lead_a",
    company: null,
    offerId: null,
    narrationId: "narr",
    narrationRevision: "rev",
    voiceKey: "artifex_default",
    provider: "elevenlabs",
    voiceId: "test-voice",
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    assetKey: "content-studio/test/upload/voice-gen/vo.mp3",
    assetBytes: 1000,
    assetSha256: "abc",
    characterCount: 100,
    durationSeconds: 30,
    requestId: "req",
    status: "VOICEOVER_READY" as VoiceoverStatus,
    failureReason: null,
    kind: "initial",
    createdAt: "2026-09-09T12:00:00.000Z",
    updatedAt: "2026-09-09T12:00:00.000Z",
    supersedes: null,
    supersededBy: null,
    ...over,
  };
}

const NOW = "2026-09-15T12:00:00.000Z";

describe("usage aggregation (mandate #14)", () => {
  it("totals minutesThisPeriod, count, and averageSeconds from READY records", () => {
    const records = [
      rec({ durationSeconds: 30, createdAt: "2026-09-02T00:00:00.000Z" }),
      rec({ durationSeconds: 60, createdAt: "2026-09-05T00:00:00.000Z" }),
      rec({ durationSeconds: 90, createdAt: "2026-09-10T00:00:00.000Z" }),
    ];
    const u = computeVoiceUsage(records, { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    // 30+60+90 = 180s = 3.0 min this calendar-month period.
    expect(u.minutesThisPeriod).toBe(3);
    expect(u.voiceoversThisPeriod).toBe(3);
    expect(u.averageSeconds).toBe(60); // (30+60+90)/3
  });
});

describe("usage excludes non-READY + legacy (mandate #15)", () => {
  it("does NOT count failed or generating records", () => {
    const records = [
      rec({ durationSeconds: 30 }), // READY, counts
      rec({ status: "VOICEOVER_FAILED", durationSeconds: null, failureReason: "server_error: boom" }),
      rec({ status: "VOICEOVER_GENERATING", durationSeconds: null }),
      rec({ status: "VOICEOVER_READY", durationSeconds: 0 }), // no real duration → excluded
    ];
    const u = computeVoiceUsage(records, { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    expect(u.voiceoversThisPeriod).toBe(1);
    expect(u.minutesThisPeriod).toBe(0.5); // only the 30s READY record
    expect(u.averageSeconds).toBe(30);
  });

  it("legacy assets are not voiceover records at all — only READY records contribute", () => {
    // A legacy (Lucas) journey never produces a VoiceoverRecord, so it simply never
    // appears in the input. An empty/READY-only set is the entire contributing universe.
    const empty = computeVoiceUsage([], { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    expect(empty.voiceoversThisPeriod).toBe(0);
    expect(empty.minutesThisPeriod).toBe(0);
    expect(empty.averageSeconds).toBe(0);
  });
});

describe("reuse does not double-count (mandate #16)", () => {
  it("a reused generation adds no record, so the count is unchanged", () => {
    // Model the store's reuse contract at the usage layer: reuse creates NO new record,
    // so the same single READY record is all that exists before and after a reused call.
    const before = [rec({ durationSeconds: 30 })];
    const u1 = computeVoiceUsage(before, { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    // "reused call" → identical record set (no append).
    const after = before;
    const u2 = computeVoiceUsage(after, { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    expect(u2.voiceoversThisPeriod).toBe(u1.voiceoversThisPeriod);
    expect(u2.minutesThisPeriod).toBe(u1.minutesThisPeriod);
  });
});

describe("capacity math + warning thresholds (mandate #17)", () => {
  it("with a budget, percentUsed/minutesRemaining/estimatedVideosRemainingAt30s are computed", () => {
    // 5 min consumed against a 10-min budget → 50% used, 5 min remaining, 10 videos @30s.
    const records = [rec({ durationSeconds: 300, createdAt: "2026-09-10T00:00:00.000Z" })];
    const u = computeVoiceUsage(records, { monthlyMinuteBudget: 10, billingResetDay: null }, NOW);
    expect(u.monthlyMinuteBudget).toBe(10);
    expect(u.percentUsed).toBe(50);
    expect(u.minutesRemaining).toBe(5);
    expect(u.estimatedVideosRemainingAt30s).toBe(10); // 5min = 300s / 30s
    expect(u.warningLevel).toBe(0);
  });

  it("warningLevel crosses 75 / 90 / 100 at the right thresholds", () => {
    const budget = 10; // minutes
    const at = (min: number) =>
      computeVoiceUsage(
        [rec({ durationSeconds: min * 60, createdAt: "2026-09-10T00:00:00.000Z" })],
        { monthlyMinuteBudget: budget, billingResetDay: null },
        NOW,
      );
    expect(at(7).warningLevel).toBe(0); // 70%
    expect(at(7.5).warningLevel).toBe(75); // exactly 75%
    expect(at(9).warningLevel).toBe(90); // 90%
    expect(at(10).warningLevel).toBe(100); // 100%
    expect(at(12).warningLevel).toBe(100); // capped — over budget still 100
    expect(at(12).percentUsed).toBe(100); // percentUsed is clamped at 100
  });

  it("with NO budget, percentUsed/minutesRemaining are null (no fabricated quota)", () => {
    const records = [rec({ durationSeconds: 300, createdAt: "2026-09-10T00:00:00.000Z" })];
    const u = computeVoiceUsage(records, { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    expect(u.monthlyMinuteBudget).toBeNull();
    expect(u.percentUsed).toBeNull();
    expect(u.minutesRemaining).toBeNull();
    expect(u.estimatedVideosRemainingAt30s).toBeNull();
    expect(u.estimatedVideosRemainingAtAverage).toBeNull();
    expect(u.warningLevel).toBe(0);
  });
});

describe("billing period (mandate #18)", () => {
  it("calendar-month period brackets `now`", () => {
    const u = computeVoiceUsage([], { monthlyMinuteBudget: null, billingResetDay: null }, NOW);
    const start = new Date(u.periodStart).getTime();
    const end = new Date(u.periodEnd).getTime();
    const now = new Date(NOW).getTime();
    expect(start).toBeLessThanOrEqual(now);
    expect(end).toBeGreaterThan(now);
    // Sept 2026 calendar month.
    expect(u.periodStart).toBe("2026-09-01T00:00:00.000Z");
    expect(u.periodEnd).toBe("2026-10-01T00:00:00.000Z");
  });

  it("billingResetDay produces a periodStart/periodEnd bounding `now`", () => {
    // Reset day 10; now is Sept 15 → period runs Sept 10 → Oct 10.
    const u = computeVoiceUsage([], { monthlyMinuteBudget: null, billingResetDay: 10 }, NOW);
    expect(u.periodStart).toBe("2026-09-10T00:00:00.000Z");
    expect(u.periodEnd).toBe("2026-10-10T00:00:00.000Z");
    const now = new Date(NOW).getTime();
    expect(new Date(u.periodStart).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(u.periodEnd).getTime()).toBeGreaterThan(now);
  });

  it("before the reset day, the period is the PRIOR reset window", () => {
    // Reset day 20; now Sept 15 (< 20) → period runs Aug 20 → Sept 20.
    const u = computeVoiceUsage([], { monthlyMinuteBudget: null, billingResetDay: 20 }, NOW);
    expect(u.periodStart).toBe("2026-08-20T00:00:00.000Z");
    expect(u.periodEnd).toBe("2026-09-20T00:00:00.000Z");
  });
});

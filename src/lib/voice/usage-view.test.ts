// ─────────────────────────────────────────────────────────────────────────────
// VOICE USAGE — the shape the capacity meter renders from. These tests lock the
// view-facing contract of computeVoiceUsage: with NO budget there is NEVER a
// fabricated remaining quota (percentUsed / minutesRemaining / estimates are all
// null), and with a budget the informational warning thresholds (75/90/100) are
// crossed correctly. Pure function — no network, no real ElevenLabs call.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { computeVoiceUsage } from "./usage";
import type { VoiceoverRecord } from "./store";

const NOW = "2026-08-15T12:00:00.000Z";

// A minimal READY record with a chosen duration, created inside the current calendar
// period. Only the fields computeVoiceUsage reads need to be real.
function ready(id: string, durationSeconds: number, createdAt = "2026-08-10T00:00:00.000Z"): VoiceoverRecord {
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

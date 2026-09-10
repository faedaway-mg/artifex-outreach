import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeVoiceCapacity, type VoiceCapacity } from "@/lib/voice/capacity";
import type { VoiceUsage } from "@/lib/voice/usage";

// ── Mock every side-effecting dependency so this is a pure control-flow test. The
//    pure pieces (script/plan/template/policy) run for real. vi.hoisted keeps the mock
//    fns available inside the hoisted vi.mock factories. ───────────────────────────
const { saveTemplate, writeUploadMeta, addDraft, createRenderJob, ensureCaption, setZeroTouchState, loadVoiceCapacity, put } = vi.hoisted(() => ({
  saveTemplate: vi.fn(async (_t?: any) => "id"),
  writeUploadMeta: vi.fn(async (_m?: any) => {}),
  addDraft: vi.fn(async (_d?: any) => {}),
  createRenderJob: vi.fn(async (_id?: any, _o?: any) => ({ job: { status: "queued" }, deduped: false })),
  ensureCaption: vi.fn(async (_s?: any) => ({})),
  setZeroTouchState: vi.fn(async (_s?: any, _a?: any) => {}),
  loadVoiceCapacity: vi.fn<() => Promise<VoiceCapacity>>(),
  put: vi.fn(async (k: string, b: Buffer) => ({ key: k, sha256: "sha", bytes: b.length })),
}));

vi.mock("@/lib/auth", () => ({ isAuthenticated: () => true, currentActor: () => "op" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./store", () => ({ getPieces: async () => [], addDraft, saveTemplate, writeUploadMeta }));
vi.mock("./caption-store", () => ({ ensureCaption }));
vi.mock("./runner", () => ({ createRenderJob }));
vi.mock("./zero-touch-store", async (orig) => {
  const real = (await orig()) as any;
  return { ...real, setZeroTouchState };
});
vi.mock("@/lib/voice/capacity-store", () => ({ loadVoiceCapacity }));
vi.mock("./storage-factory", () => ({ getArtifactStore: () => ({ put }) }));
vi.mock("@/lib/voice/elevenlabs-config", () => ({ elevenLabsConfigured: () => false })); // → mock (no-spend) path

import { generateZeroTouch } from "./zero-touch-actions";

function usage(over: Partial<VoiceUsage> = {}): VoiceUsage {
  return {
    periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z",
    minutesThisPeriod: 71, minutesToday: 3, minutesThisWeek: 20, voiceoversThisPeriod: 40, averageSeconds: 30,
    measuredThisPeriod: 40, estimatedThisPeriod: 0, monthlyMinuteBudget: 220, percentUsed: 32, minutesRemaining: 149,
    estimatedVideosRemainingAtAverage: 298, estimatedVideosRemainingAt30s: 298, billingResetDate: "2026-10-01T00:00:00.000Z",
    warningLevel: 0, hardCapMinutes: null, hardCapReached: false, quotaUnknown: false, ...over,
  };
}
const reserve = (min: number) => ({ minutes: min, basis: "forecast" as const, detail: "x", forecastPackages: 10 });
const capacity = (remaining: number, reserveMin: number): VoiceCapacity =>
  computeVoiceCapacity({ usage: usage({ minutesRemaining: remaining }), allowanceSource: "operator", reserve: reserve(reserveMin), nowIso: "2026-09-10T00:00:00.000Z" });

const BRIEF = "Visitors try to book after 6pm and hit a dead form. That silence is lost revenue. A simple capture path recovers it.";

describe("generateZeroTouch — renderability + capacity enforcement", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.CS_RENDER_MODE = "worker"; });

  it("HEALTHY → saves a renderable template, bridges audio, enqueues the render (one action)", async () => {
    loadVoiceCapacity.mockResolvedValue(capacity(149, 95));
    const res = await generateZeroTouch({ title: "Field note", brief: BRIEF });
    expect(res.ok).toBe(true);
    expect(res.stage).toBe("BUILDING_VIDEO");
    // The missing-link fix: a renderable social template is persisted.
    expect(saveTemplate).toHaveBeenCalledTimes(1);
    const tpl = saveTemplate.mock.calls[0][0] as any;
    expect(tpl.workflow).toBe("social");
    // Audio bridged into the upload slot so the worker muxes it; render enqueued.
    expect(writeUploadMeta).toHaveBeenCalledTimes(1);
    expect(createRenderJob).toHaveBeenCalledWith(expect.any(String), { useUpload: true });
    // No ElevenLabs spend on the no-spend path.
    expect(res.voiceStatus).toMatch(/mock/);
  });

  it("RESERVE BOUNDARY without override → NEEDS_OVERRIDE, and NOTHING is generated (no spend/side-effects)", async () => {
    loadVoiceCapacity.mockResolvedValue(capacity(95.2, 95)); // social available 0.2 min; 30s gen crosses reserve
    const res = await generateZeroTouch({ title: "Field note", brief: BRIEF });
    expect(res.ok).toBe(false);
    expect(res.needsOverride).toBe(true);
    expect(res.stage).toBe("NEEDS_OVERRIDE");
    expect(saveTemplate).not.toHaveBeenCalled();
    expect(writeUploadMeta).not.toHaveBeenCalled();
    expect(createRenderJob).not.toHaveBeenCalled();
    expect(res.forecast?.crossesReserve).toBe(true);
  });

  it("RESERVE BOUNDARY with explicit override → the single generation proceeds", async () => {
    loadVoiceCapacity.mockResolvedValue(capacity(95.2, 95));
    const res = await generateZeroTouch({ title: "Field note", brief: BRIEF, override: true });
    expect(res.ok).toBe(true);
    expect(createRenderJob).toHaveBeenCalledTimes(1);
  });

  it("unknown capacity never fabricates a limit → generation proceeds", async () => {
    loadVoiceCapacity.mockResolvedValue(
      computeVoiceCapacity({ usage: usage({ monthlyMinuteBudget: null, minutesRemaining: null, quotaUnknown: true }), allowanceSource: "unset", reserve: reserve(30), nowIso: "2026-09-10T00:00:00.000Z" }),
    );
    const res = await generateZeroTouch({ title: "Field note", brief: BRIEF });
    expect(res.ok).toBe(true);
  });

  it("empty brief is refused before any work", async () => {
    const res = await generateZeroTouch({ brief: "   " });
    expect(res.ok).toBe(false);
    expect(saveTemplate).not.toHaveBeenCalled();
  });
});

import { describe, it, expect } from "vitest";
import { renderLifecycle, canGenerate, type LifecycleInput } from "./render-lifecycle";

const base: LifecycleInput = {
  renderable: true, isClient: true, hasAudio: false, hasScreenshot: true,
  hasVerifiedOutput: false, latestJob: null, maxAttempts: 3,
};

describe("render lifecycle (section I-D)", () => {
  it("NEEDS_AUDIO when a renderable piece has no upload", () => {
    expect(renderLifecycle(base).state).toBe("NEEDS_AUDIO");
  });

  it("READY_TO_GENERATE when audio + screenshot present, no job", () => {
    expect(renderLifecycle({ ...base, hasAudio: true }).state).toBe("READY_TO_GENERATE");
  });

  it("a client with audio but no screenshot is not yet generatable (canGenerate false)", () => {
    const inp = { ...base, hasAudio: true, hasScreenshot: false };
    expect(renderLifecycle(inp).state).toBe("READY_TO_GENERATE"); // state stays in the 7-set…
    expect(canGenerate(inp).ok).toBe(false); // …but Generate is blocked with a reason
  });

  it("QUEUED and RENDERING reflect the active job", () => {
    expect(renderLifecycle({ ...base, hasAudio: true, latestJob: { status: "queued", attempt: 1 } }).state).toBe("QUEUED");
    expect(renderLifecycle({ ...base, hasAudio: true, latestJob: { status: "rendering", attempt: 1 } }).state).toBe("RENDERING");
  });

  it("READY only when a verified output exists", () => {
    expect(renderLifecycle({ ...base, hasAudio: true, hasVerifiedOutput: true, latestJob: { status: "ready", attempt: 1 } }).state).toBe("READY");
  });

  it("a failed history NEVER overrides a verified ready output", () => {
    const r = renderLifecycle({ ...base, hasAudio: true, hasVerifiedOutput: true, latestJob: { status: "failed", attempt: 2 } });
    expect(r.state).toBe("READY");
  });

  it("FAILED_RETRYABLE below maxAttempts, FAILED_FINAL at/above", () => {
    expect(renderLifecycle({ ...base, hasAudio: true, latestJob: { status: "failed", attempt: 1 } }).state).toBe("FAILED_RETRYABLE");
    expect(renderLifecycle({ ...base, hasAudio: true, latestJob: { status: "failed", attempt: 3 } }).state).toBe("FAILED_FINAL");
  });

  it("canGenerate gates on renderable + audio + screenshot", () => {
    expect(canGenerate({ renderable: true, isClient: true, hasAudio: true, hasScreenshot: true }).ok).toBe(true);
    expect(canGenerate({ renderable: true, isClient: false, hasAudio: true, hasScreenshot: false }).ok).toBe(true); // non-client needs no shot
    expect(canGenerate({ renderable: false, isClient: false, hasAudio: true, hasScreenshot: true }).ok).toBe(false);
  });
});

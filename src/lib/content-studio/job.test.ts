import { describe, it, expect } from "vitest";
import { canTransition, isActive, isTerminal, inputVersion, findActiveDuplicate, latestReadyJob, isOutputStale } from "./job";
import type { RenderJob } from "./types";

function job(p: Partial<RenderJob>): RenderJob {
  return {
    id: p.id ?? "j1", pieceId: p.pieceId ?? "004", inputVersion: p.inputVersion ?? "v1",
    status: p.status ?? "queued", progress: p.progress ?? 0, stage: "", mode: "reuse-approved-audio",
    audioFile: null, audioLabel: null, outputFile: null, outputRel: p.outputRel ?? null, thumbRel: null,
    error: null, attempt: 1, pid: null,
    createdAt: p.createdAt ?? "2026-01-01T00:00:00Z", updatedAt: "", startedAt: null,
    finishedAt: p.finishedAt ?? null,
  };
}

describe("job state machine", () => {
  it("allows only bounded transitions", () => {
    expect(canTransition("queued", "rendering")).toBe(true);
    expect(canTransition("rendering", "ready")).toBe(true);
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("ready", "rendering")).toBe(false); // ready is terminal
    expect(canTransition("queued", "ready")).toBe(false); // must render first
  });
  it("classifies active/terminal", () => {
    expect(isActive("rendering")).toBe(true);
    expect(isActive("ready")).toBe(false);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("queued")).toBe(false);
  });
});

describe("inputVersion", () => {
  it("is deterministic and input-sensitive", () => {
    const a = inputVersion({ scriptVersion: "s1", audioSig: "approved", templateVersion: "t1" });
    const b = inputVersion({ scriptVersion: "s1", audioSig: "approved", templateVersion: "t1" });
    const c = inputVersion({ scriptVersion: "s1", audioSig: "upload.mp3:123:30.00", templateVersion: "t1" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^v[0-9a-f]{8}$/);
  });
});

describe("duplicate guard", () => {
  it("returns an in-flight job with matching piece+version, ignores terminal ones", () => {
    const jobs = [job({ id: "a", status: "ready", inputVersion: "v1" }), job({ id: "b", status: "rendering", inputVersion: "v2" })];
    expect(findActiveDuplicate(jobs, "004", "v2")?.id).toBe("b");
    expect(findActiveDuplicate(jobs, "004", "v1")).toBeNull(); // ready is not active
    expect(findActiveDuplicate(jobs, "004", "v9")).toBeNull();
  });
});

describe("latest ready + staleness", () => {
  it("picks the newest ready output", () => {
    const jobs = [
      job({ id: "a", status: "ready", finishedAt: "2026-01-01T00:00:00Z", outputRel: "/a.mp4" }),
      job({ id: "b", status: "ready", finishedAt: "2026-02-01T00:00:00Z", outputRel: "/b.mp4" }),
    ];
    expect(latestReadyJob(jobs, "004")?.id).toBe("b");
  });
  it("marks a ready output stale when newer inputs exist", () => {
    const ready = job({ id: "a", status: "ready", inputVersion: "v1", createdAt: "2026-01-01T00:00:00Z" });
    const jobs = [ready, job({ id: "b", status: "rendering", inputVersion: "v2", createdAt: "2026-01-02T00:00:00Z" })];
    expect(isOutputStale(jobs, ready)).toBe(true);
    expect(isOutputStale([ready], ready)).toBe(false);
  });
});

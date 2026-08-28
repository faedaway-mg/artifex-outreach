// Durability + recovery integration tests against the REAL file-backed store in an ISOLATED temp dir
// (CONTENT_STUDIO_DATA_DIR) — not the mock/in-memory path. Proves persistence survives a simulated
// process restart, dedup holds, stale/failed jobs never clobber a good output, and crashed workers
// reconcile to failed.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RenderJob } from "./types";

let DIR: string;
let store: typeof import("./store");
const { findActiveDuplicate, latestReadyJob, isOutputStale } = await import("./job");

function job(p: Partial<RenderJob>): RenderJob {
  const now = new Date().toISOString();
  return {
    id: p.id ?? "csjob_x", pieceId: p.pieceId ?? "007", inputVersion: p.inputVersion ?? "v1",
    status: p.status ?? "queued", progress: p.progress ?? 0, stage: p.stage ?? "", mode: p.mode ?? "uploaded-vo",
    audioFile: p.audioFile ?? null, audioLabel: null, outputFile: p.outputFile ?? null, outputRel: p.outputRel ?? null,
    thumbRel: null, error: p.error ?? null, attempt: p.attempt ?? 1, pid: p.pid ?? null,
    createdAt: p.createdAt ?? now, updatedAt: p.updatedAt ?? now, startedAt: p.startedAt ?? null, finishedAt: p.finishedAt ?? null,
  };
}

beforeAll(async () => {
  DIR = mkdtempSync(path.join(tmpdir(), "cs-durability-"));
  vi.stubEnv("CONTENT_STUDIO_DATA_DIR", DIR);
  store = await import("./store");
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("persistence survives browser refresh + process restart", () => {
  it("a written job is readable from disk (refresh = re-read)", async () => {
    await store.writeJob(job({ id: "csjob_a", status: "rendering", progress: 0.5 }));
    const again = await store.readJob("csjob_a");
    expect(again?.progress).toBe(0.5);
    expect((await store.listJobs()).some((j) => j.id === "csjob_a")).toBe(true);
  });

  it("a fresh module instance (app/worker restart) sees the same on-disk jobs", async () => {
    vi.resetModules();
    vi.stubEnv("CONTENT_STUDIO_DATA_DIR", DIR);
    const store2 = await import("./store");
    const jobs = await store2.listJobs();
    expect(jobs.some((j) => j.id === "csjob_a")).toBe(true); // durable across a new process
  });
});

describe("duplicate render requests", () => {
  it("a second active job for the same piece+version is refused by the guard", async () => {
    await store.writeJob(job({ id: "csjob_dup1", pieceId: "007", inputVersion: "vDUP", status: "rendering" }));
    const jobs = await store.listJobs();
    expect(findActiveDuplicate(jobs, "007", "vDUP")?.id).toBe("csjob_dup1"); // dedup → reuse existing
  });
});

describe("two workers, same job file", () => {
  it("concurrent patches never corrupt the JSON (atomic rename)", async () => {
    await store.writeJob(job({ id: "csjob_race", status: "rendering", progress: 0 }));
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      store.readJob("csjob_race").then((j) => store.writeJob({ ...(j as RenderJob), progress: i / 20 })),
    ));
    const final = await store.readJob("csjob_race");
    expect(final).not.toBeNull();
    expect(final!.progress).toBeGreaterThanOrEqual(0); // still valid, parseable JSON
  });
});

describe("input change during render → staleness; failed retry never clobbers success", () => {
  it("a newer-version job marks a prior ready output stale", () => {
    const ready = job({ id: "r1", inputVersion: "v1", status: "ready", createdAt: "2026-01-01T00:00:00Z", outputRel: "/good.mp4" });
    const newer = job({ id: "r2", inputVersion: "v2", status: "rendering", createdAt: "2026-01-02T00:00:00Z" });
    expect(isOutputStale([ready, newer], ready)).toBe(true);
  });

  it("a failed retry leaves the previous successful output intact", async () => {
    await store.writeJob(job({ id: "ok1", pieceId: "007", status: "ready", finishedAt: "2026-02-01T00:00:00Z", outputRel: "/content/field-note-007/field-note-007-final.mp4" }));
    await store.writeJob(job({ id: "fail1", pieceId: "007", status: "failed", createdAt: "2026-02-02T00:00:00Z", error: "boom" }));
    const jobs = await store.listJobs();
    const ready = latestReadyJob(jobs, "007");
    expect(ready?.id).toBe("ok1"); // success preserved despite a later failure
    expect(ready?.outputRel).toContain("field-note-007-final.mp4");
  });
});

describe("crashed worker reconciliation", () => {
  it("a stale rendering job whose process is gone becomes failed; a fresh one is left alone", async () => {
    const { reconcileStale } = await import("./runner");
    const old = job({ id: "c1", status: "rendering", pid: 2 ** 30, updatedAt: "2020-01-01T00:00:00Z" }); // ancient + impossible pid
    expect(reconcileStale(old).status).toBe("failed");
    const fresh = job({ id: "c2", status: "rendering", pid: process.pid, updatedAt: new Date().toISOString() });
    expect(reconcileStale(fresh).status).toBe("rendering"); // alive + recent → untouched
  });
});

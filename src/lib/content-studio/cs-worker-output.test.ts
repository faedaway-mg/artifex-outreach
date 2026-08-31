// SLICE 2 — worker OUTPUT + poster publication. Proves the render worker publishes the rendered mp4 and
// the frame-zero poster to the ArtifactStore BY CANONICAL KEY (ownership-fenced by jobId, atomic +
// idempotent), that the web side then reads both back by key with intact bytes, that a retry of the SAME
// job republishes to the SAME key, and that a DIFFERENT job can never overwrite (the fence). Local
// backend; the same guarantees hold on Postgres via cs-storage-pg.test.ts.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

let DIR: string;
let store: typeof import("./storage-factory");
let worker: any; // .mjs (JS) module — untyped, exercised at runtime
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const localEnv = { NODE_ENV: "test", CS_STORAGE_PROVIDER: "local" } as unknown as NodeJS.ProcessEnv;

beforeAll(async () => {
  DIR = mkdtempSync(path.join(tmpdir(), "cs-worker-output-"));
  process.env.CONTENT_STUDIO_DATA_DIR = DIR;
  process.env.CS_STORAGE_PROVIDER = "local";
  store = await import("./storage-factory");
  worker = await import("../../../scripts/lib/cs-artifacts.mjs");
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete process.env.CONTENT_STUDIO_DATA_DIR; delete process.env.CS_STORAGE_PROVIDER; });

const outputKey = (jobId: string) => worker.buildObjectKey({ artifactClass: "render-output", env: "test", jobId, version: "v1", ext: "mp4" });
const posterKey = (jobId: string) => worker.buildObjectKey({ artifactClass: "poster", env: "test", jobId, version: "v1", ext: "png" });

describe("worker output: publish mp4 + poster by key", () => {
  it("publishes video + poster; the web reads both back by key with intact bytes", async () => {
    const jobId = "csjob_out1";
    const video = Buffer.from("RENDERED-MP4-BYTES-worker-output-publication-0001");
    const poster = Buffer.from("POSTER-PNG-frame-zero-cover-0001");
    await worker.putArtifact(outputKey(jobId), video, "video/mp4", { artifactClass: "render-output", jobId });
    await worker.putArtifact(posterKey(jobId), poster, "image/png", { artifactClass: "poster", jobId });

    const vMeta = await store.getArtifactStore(localEnv).getMeta(outputKey(jobId));
    const pMeta = await store.getArtifactStore(localEnv).getMeta(posterKey(jobId));
    expect(vMeta?.size).toBe(video.length);
    expect(vMeta?.contentType).toBe("video/mp4");
    expect(pMeta?.size).toBe(poster.length);
    const vBytes = await store.getArtifactStore(localEnv).readFull(outputKey(jobId));
    expect(sha(vBytes!)).toBe(sha(video));
  });

  it("is idempotent: the SAME job republishing the SAME key succeeds with identical bytes", async () => {
    const jobId = "csjob_out2";
    const video = Buffer.from("idempotent-retry-same-job-same-key");
    await worker.putArtifact(outputKey(jobId), video, "video/mp4", { artifactClass: "render-output", jobId });
    // retry (bumped attempt, same jobId) — must not throw, bytes unchanged
    await worker.putArtifact(outputKey(jobId), video, "video/mp4", { artifactClass: "render-output", jobId });
    const bytes = await store.getArtifactStore(localEnv).readFull(outputKey(jobId));
    expect(sha(bytes!)).toBe(sha(video));
  });

  it("is ownership-fenced: a DIFFERENT job cannot overwrite an existing output key", async () => {
    const key = outputKey("csjob_owner");
    await worker.putArtifact(key, Buffer.from("owned-by-first-job"), "video/mp4", { artifactClass: "render-output", jobId: "csjob_owner" });
    await expect(worker.putArtifact(key, Buffer.from("hostile-overwrite"), "video/mp4", { artifactClass: "render-output", jobId: "csjob_intruder" }))
      .rejects.toThrow(/ownership-fenced/i);
    // original bytes survive
    const bytes = await store.getArtifactStore(localEnv).readFull(key);
    expect(bytes!.toString()).toBe("owned-by-first-job");
  });
});

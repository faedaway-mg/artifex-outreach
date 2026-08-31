// SLICE 3 — hosted-share cutover. Proves a hosted share of a render that already has a DURABLE output
// key REFERENCES that key (no byte copy), that the media helpers read the bound object by key (with
// Range), and that revocation hides the object entirely (the route would 410). Local backend.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RenderJob } from "./types";

let DIR: string;
let store: typeof import("./store");
let share: typeof import("./share");
let factory: typeof import("./storage-factory");

function readyJob(p: Partial<RenderJob>): RenderJob {
  const now = new Date().toISOString();
  return {
    id: p.id!, pieceId: p.pieceId!, inputVersion: p.inputVersion ?? "v1", status: "ready", progress: 1, stage: "Ready",
    mode: "uploaded-vo", audioKind: "uploaded", audioFile: null, audioKey: null, audioSha: null, audioLabel: null,
    outputFile: null, outputRel: null, outputKey: p.outputKey ?? null, posterKey: p.posterKey ?? null,
    thumbRel: null, error: null, attempt: 1, pid: null, createdAt: now, updatedAt: now, startedAt: now, finishedAt: now,
  };
}

beforeAll(async () => {
  DIR = mkdtempSync(path.join(tmpdir(), "cs-share-cutover-"));
  vi.stubEnv("CONTENT_STUDIO_DATA_DIR", DIR);
  vi.stubEnv("CS_STORAGE_PROVIDER", "local");
  store = await import("./store");
  share = await import("./share");
  factory = await import("./storage-factory");
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("hosted share references the durable output key (no copy)", () => {
  it("binds the share to the render's output key and reads it back by key + Range", async () => {
    const pieceId = "share_ref";
    const jobId = "csjob_ref";
    const video = Buffer.from("APPROVED-RENDER-OUTPUT-durable-key-referenced-by-share-XYZ");
    // A render published its output durably (worker path).
    const outputKey = factory.getArtifactStore().mode === "local"
      ? (await import("../../../scripts/lib/cs-artifacts.mjs") as any).buildObjectKey({ artifactClass: "render-output", env: "test", jobId, version: "v1", ext: "mp4" })
      : "";
    await factory.getArtifactStore().put(outputKey, video, { artifactClass: "render-output", contentType: "video/mp4", jobId });

    await store.writeJob(readyJob({ id: jobId, pieceId, outputKey, inputVersion: "v1" }));
    await store.setApproval({ pieceId, jobId, inputVersion: "v1", outputRel: "/x.mp4", audioSig: "uploaded", approvedAt: new Date().toISOString() });

    const r = await share.createShare(pieceId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // REFERENCE, not copy: the share's videoKey IS the render output key.
    expect(r.share.videoKey).toBe(outputKey);

    // Media helper reads the bound object by key with a Range slice.
    const vm = await share.shareVideoMeta(r.share.token);
    expect(vm?.meta.size).toBe(video.length);
    const slice = await share.readShareVideoRange(r.share.videoKey, 0, 9);
    expect(slice!.equals(video.subarray(0, 10))).toBe(true);
  });

  it("revocation hides the object (media helper returns null → route 410)", async () => {
    const pieceId = "share_rev2";
    const jobId = "csjob_rev2";
    const worker: any = await import("../../../scripts/lib/cs-artifacts.mjs");
    const outputKey = worker.buildObjectKey({ artifactClass: "render-output", env: "test", jobId, version: "v1", ext: "mp4" });
    await factory.getArtifactStore().put(outputKey, Buffer.from("revocable-video"), { artifactClass: "render-output", contentType: "video/mp4", jobId });
    await store.writeJob(readyJob({ id: jobId, pieceId, outputKey, inputVersion: "v1" }));
    await store.setApproval({ pieceId, jobId, inputVersion: "v1", outputRel: "/x.mp4", audioSig: "uploaded", approvedAt: new Date().toISOString() });

    const r = await share.createShare(pieceId);
    if (!r.ok) throw new Error("setup");
    expect(await share.shareVideoMeta(r.share.token)).not.toBeNull(); // live → resolves
    await share.revokeShare(r.share.token);
    expect(await share.shareVideoMeta(r.share.token)).toBeNull(); // revoked → nothing exposed
    expect(await share.sharePoster(r.share.token)).toBeNull();
  });
});

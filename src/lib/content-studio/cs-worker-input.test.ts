// SLICE 1 — worker INPUT retrieval. Proves the render worker reads its source voiceover BY OBJECT KEY
// through the ArtifactStore (never a filesystem path from the web), materializes it to a unique temp
// file with its bytes intact, and REJECTS a missing / tampered / deleted input. Exercises the exact
// helper the worker calls (materializeArtifact in scripts/lib/cs-artifacts.mjs) on the local backend.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

let DIR: string;
let store: typeof import("./storage-factory");
let worker: any; // .mjs (JS) module — untyped, exercised at runtime
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const localEnv = { NODE_ENV: "test", CS_STORAGE_PROVIDER: "local" } as unknown as NodeJS.ProcessEnv;

beforeAll(async () => {
  DIR = mkdtempSync(path.join(tmpdir(), "cs-worker-input-"));
  process.env.CONTENT_STUDIO_DATA_DIR = DIR;
  process.env.CS_STORAGE_PROVIDER = "local";
  store = await import("./storage-factory");
  worker = await import("../../../scripts/lib/cs-artifacts.mjs");
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete process.env.CONTENT_STUDIO_DATA_DIR; delete process.env.CS_STORAGE_PROVIDER; });

describe("worker input: materialize voiceover by object key", () => {
  it("reads the uploaded VO by key and writes intact bytes to a unique temp file", async () => {
    const body = Buffer.from("VOICEOVER-BYTES-worker-input-materialize-9876543210");
    const key = worker.buildObjectKey({ artifactClass: "upload", env: "test", operatorId: "007", version: "up1", ext: "mp3" });
    // Web side stores the source bytes through the ONE ArtifactStore.
    await store.getArtifactStore(localEnv).put(key, body, { artifactClass: "upload", contentType: "audio/mpeg" });

    const dest = mkdtempSync(path.join(tmpdir(), "cs-mat-"));
    const { path: p, sha: hash, bytes } = await worker.materializeArtifact(key, { destDir: dest, filename: "vo-input.mp3", expectedSha: sha(body) });
    expect(existsSync(p)).toBe(true);
    expect(p.startsWith(dest)).toBe(true); // only a temp file — never the web's path
    expect(bytes).toBe(body.length);
    expect(hash).toBe(sha(body));
    expect(sha(readFileSync(p))).toBe(sha(body)); // identical bytes across the boundary
    rmSync(dest, { recursive: true, force: true });
  });

  it("rejects a MISSING key (never renders a phantom input)", async () => {
    await expect(worker.materializeArtifact("content-studio/test/upload/007/nope.mp3", { destDir: DIR, filename: "x.mp3" }))
      .rejects.toThrow(/unavailable|missing/i);
  });

  it("rejects a TAMPERED input (expected sha ≠ stored bytes)", async () => {
    const body = Buffer.from("original-authentic-voiceover");
    const key = worker.buildObjectKey({ artifactClass: "upload", env: "test", operatorId: "007", version: "up2", ext: "mp3" });
    await store.getArtifactStore(localEnv).put(key, body, { artifactClass: "upload", contentType: "audio/mpeg" });
    await expect(worker.materializeArtifact(key, { destDir: DIR, filename: "y.mp3", expectedSha: sha(Buffer.from("something-else")) }))
      .rejects.toThrow(/integrity/i);
  });

  it("rejects a DELETED input (soft-deleted key is unreadable)", async () => {
    const body = Buffer.from("to-be-deleted-voiceover");
    const key = worker.buildObjectKey({ artifactClass: "upload", env: "test", operatorId: "007", version: "up3", ext: "mp3" });
    await store.getArtifactStore(localEnv).put(key, body, { artifactClass: "upload", contentType: "audio/mpeg" });
    await worker.deleteArtifact(key);
    await expect(worker.materializeArtifact(key, { destDir: DIR, filename: "z.mp3" }))
      .rejects.toThrow(/unavailable|missing|unreadable/i);
  });
});

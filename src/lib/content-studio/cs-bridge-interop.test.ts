// Proves the web (TS getArtifactStore) and the worker (Node cs-artifacts.mjs) exchange only object keys
// and read IDENTICAL bytes — on the local backend (dev). Same key → same bytes both directions. This is
// the cutover's core guarantee: no filesystem paths cross the boundary, only keys.
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
  DIR = mkdtempSync(path.join(tmpdir(), "cs-bridge-"));
  process.env.CONTENT_STUDIO_DATA_DIR = DIR;
  process.env.CS_STORAGE_PROVIDER = "local";
  store = await import("./storage-factory");
  worker = await import("../../../scripts/lib/cs-artifacts.mjs");
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete process.env.CONTENT_STUDIO_DATA_DIR; delete process.env.CS_STORAGE_PROVIDER; });

describe("web ↔ worker artifact bridge (local backend, keys only)", () => {
  it("WEB writes → WORKER reads identical bytes by the same key", async () => {
    const body = Buffer.from("UPLOAD-BYTES-web-writes-worker-reads-0123456789");
    const key = "content-studio/test/upload/op/up1.mp3";
    await store.getArtifactStore(localEnv).put(key, body, { artifactClass: "upload", contentType: "audio/mpeg" });
    const back = await worker.readArtifactFull(key);
    expect(back).not.toBeNull();
    expect(sha(back!)).toBe(sha(body)); // identical bytes across the boundary
  });

  it("WORKER writes (render output) → WEB reads meta + exact Range slice by key", async () => {
    const body = Buffer.from("RENDER-OUTPUT-worker-writes-web-serves-abcdefghij");
    const key = worker.buildObjectKey({ artifactClass: "render-output", env: "test", jobId: "csjob_x", version: "v1", ext: "mp4" });
    await worker.putArtifact(key, body, "video/mp4", { artifactClass: "render-output", jobId: "csjob_x" });
    const meta = await store.getArtifactStore(localEnv).getMeta(key);
    expect(meta?.size).toBe(body.length);
    const slice = await store.getArtifactStore(localEnv).readRange(key, 0, 5);
    expect(slice!.equals(body.subarray(0, 6))).toBe(true); // web serves a Range from the worker's output
  });

  it("both sides derive the SAME canonical key (no path exchange)", async () => {
    // The TS object-key builder and the Node one must agree byte-for-byte.
    const ts = (await import("./cs-object-key")).buildObjectKey({ artifactClass: "poster", env: "production", jobId: "j", version: "v9", ext: "jpg" });
    const nd = worker.buildObjectKey({ artifactClass: "poster", env: "production", jobId: "j", version: "v9", ext: "jpg" });
    expect(ts).toBe(nd);
    expect(ts).toBe("content-studio/production/poster/j/v9.jpg");
  });
});

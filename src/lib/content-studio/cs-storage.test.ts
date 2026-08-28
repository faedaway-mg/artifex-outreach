// Storage-contract tests against the DURABLE local backend (isolated dir). Proves key derivation, atomic
// put→get round-trip, existence, and delete — the same contract the S3/R2 backend implements once
// provisioned. (S3 path is credential-gated; not exercised locally.)
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let DIR: string, S: typeof import("./cs-storage");

beforeAll(async () => {
  DIR = mkdtempSync(path.join(tmpdir(), "cs-storage-"));
  vi.stubEnv("CONTENT_STUDIO_DATA_DIR", DIR);
  vi.stubEnv("STORAGE_PROVIDER", "mock"); // durable local backend
  S = await import("./cs-storage");
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); vi.unstubAllEnvs(); });

async function streamToBuf(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe("cs-storage contract (durable local backend)", () => {
  it("derives namespaced, sanitized keys", () => {
    expect(S.csKey("output", "field-note-007-final", "mp4")).toBe("content-studio/output/field-note-007-final.mp4");
    // slashes are stripped (no path traversal); dots are allowed
    expect(S.csKey("upload", "007/../etc", "mp3")).toBe("content-studio/upload/007_.._etc.mp3");
    expect(S.usingS3()).toBe(false);
  });

  it("put → exists → get round-trips durably", async () => {
    const key = S.csKey("share-media", "tok123", "mp4");
    expect(await S.artifactExists(key)).toBe(false);
    await S.putArtifact(key, Buffer.from("hello-video"), "video/mp4");
    expect(await S.artifactExists(key)).toBe(true);
    const got = await S.getArtifact(key);
    expect(got).not.toBeNull();
    expect((await streamToBuf(got!.stream)).toString()).toBe("hello-video");
    expect(got!.size).toBe(11);
  });

  it("delete removes the artifact", async () => {
    const key = S.csKey("poster", "tok999", "jpg");
    await S.putArtifact(key, Buffer.from("img"), "image/jpeg");
    expect(await S.artifactExists(key)).toBe(true);
    await S.deleteArtifact(key);
    expect(await S.artifactExists(key)).toBe(false);
  });

  it("getArtifact returns null for a missing key", async () => {
    expect(await S.getArtifact(S.csKey("output", "nope", "mp4"))).toBeNull();
  });
});

// PostgreSQL artifact adapter — integration test against a REAL Postgres (gated on CS_DATABASE_URL, so
// it skips in environments without a DB). Proves atomic publish, SHA-256, SERVER-SIDE Range slicing,
// ownership fence, idempotency, soft-delete/expiry unavailability, and storage accounting.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";

const HAS_DB = Boolean(process.env.CS_DATABASE_URL);
const d = HAS_DB ? describe : describe.skip;

let S: typeof import("./cs-storage-pg");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeAll(async () => { if (HAS_DB) S = await import("./cs-storage-pg"); });
afterAll(async () => { if (HAS_DB && S) await S.__closePgForTests(); });

d("cs-storage-pg (real Postgres)", () => {
  const body = Buffer.from("ARTIFEX-VIDEO-BYTES-0123456789-abcdefghijklmnopqrstuvwxyz"); // 57 bytes

  it("atomic publish stores bytes + correct sha256 + size", async () => {
    const r = await S.putArtifactPg("content-studio/output/t1.mp4", body, "video/mp4", { artifactClass: "output", jobId: "job1" });
    expect(r.bytes).toBe(body.length);
    expect(r.sha256).toBe(sha(body));
    const meta = await S.getArtifactMetaPg("content-studio/output/t1.mp4");
    expect(meta?.size).toBe(body.length);
    expect(meta?.contentType).toBe("video/mp4");
    expect(meta?.sha256).toBe(sha(body));
  });

  it("SERVER-SIDE Range returns exactly the requested slice", async () => {
    const chunk = await S.readArtifactRangePg("content-studio/output/t1.mp4", 0, 9); // first 10 bytes
    expect(chunk?.length).toBe(10);
    expect(chunk!.equals(body.subarray(0, 10))).toBe(true);
    const mid = await S.readArtifactRangePg("content-studio/output/t1.mp4", 10, 19);
    expect(mid!.equals(body.subarray(10, 20))).toBe(true);
    const full = await S.readArtifactFullPg("content-studio/output/t1.mp4");
    expect(full!.equals(body)).toBe(true);
    expect(sha(full!)).toBe(sha(body)); // round-trip integrity
  });

  it("idempotent re-publish (same key) overwrites cleanly", async () => {
    const body2 = Buffer.from("NEW-BYTES");
    await S.putArtifactPg("content-studio/output/t1.mp4", body2, "video/mp4", { artifactClass: "output", jobId: "job1" });
    const full = await S.readArtifactFullPg("content-studio/output/t1.mp4");
    expect(full!.equals(body2)).toBe(true);
  });

  it("ownership-fenced: a DIFFERENT job cannot overwrite the artifact", async () => {
    await expect(S.putArtifactPg("content-studio/output/t1.mp4", Buffer.from("HOSTILE"), "video/mp4", { artifactClass: "output", jobId: "OTHER-JOB" }))
      .rejects.toThrow(/ownership-fenced/);
  });

  it("soft delete makes the artifact unavailable (revoke path)", async () => {
    await S.putArtifactPg("content-studio/share-media/tok.mp4", body, "video/mp4", { artifactClass: "share-media", shareToken: "tok" });
    expect(await S.artifactExistsPg("content-studio/share-media/tok.mp4")).toBe(true);
    await S.deleteArtifactPg("content-studio/share-media/tok.mp4");
    expect(await S.artifactExistsPg("content-studio/share-media/tok.mp4")).toBe(false); // → route returns 410
    expect(await S.readArtifactRangePg("content-studio/share-media/tok.mp4", 0, 5)).toBeNull();
  });

  it("expiry sweeps abandoned artifacts", async () => {
    await S.putArtifactPg("content-studio/upload/old.mp3", Buffer.from("x"), "audio/mpeg", { artifactClass: "upload", expiresAt: new Date(Date.now() - 1000) });
    const swept = await S.expireArtifactsPg();
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(await S.artifactExistsPg("content-studio/upload/old.mp3")).toBe(false);
  });

  it("storage accounting reflects live bytes/count", async () => {
    const usage = await S.storageUsagePg();
    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.artifactCount).toBeGreaterThan(0);
  });
});

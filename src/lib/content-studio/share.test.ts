// Hosted-share invariants against the REAL file store (isolated dir): only an approved, non-placeholder
// render is shareable; the shared video is frozen + immutable across regeneration; the prepared email
// never attaches an MP4 or embeds a player; revocation disables access.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RenderJob } from "./types";
import { getArtifactStore } from "./storage-factory";

let DIR: string, store: typeof import("./store"), share: typeof import("./share");

function mp4(file: string, seconds = 1) {
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=black:s=1080x1920:d=${seconds}`, "-c:v", "libx264", "-t", String(seconds), "-pix_fmt", "yuv420p", file], { stdio: "ignore" });
}
function job(p: Partial<RenderJob>): RenderJob {
  const now = new Date().toISOString();
  return { id: p.id ?? "j", pieceId: p.pieceId ?? "007", inputVersion: p.inputVersion ?? "v1", status: p.status ?? "ready",
    progress: 1, stage: "Ready", mode: "uploaded-vo", audioKind: p.audioKind ?? "uploaded", audioFile: null, audioKey: null, audioSha: null, audioLabel: null,
    outputFile: p.outputFile ?? null, outputRel: p.outputRel ?? "/content/x.mp4", outputKey: p.outputKey ?? null, posterKey: p.posterKey ?? null, thumbRel: null, error: null, attempt: 1, pid: null,
    createdAt: p.createdAt ?? now, updatedAt: now, startedAt: now, finishedAt: p.finishedAt ?? now };
}

beforeAll(async () => {
  DIR = mkdtempSync(path.join(tmpdir(), "cs-share-"));
  vi.stubEnv("CONTENT_STUDIO_DATA_DIR", DIR);
  store = await import("./store"); share = await import("./share");
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); vi.unstubAllEnvs(); });

async function readyApprovedJob(pieceId: string, audioKind: RenderJob["audioKind"] = "uploaded", approve = true) {
  const out = path.join(DIR, `${pieceId}-out.mp4`); mp4(out);
  const j = job({ id: `job_${pieceId}`, pieceId, outputFile: out, audioKind, inputVersion: "v1" });
  await store.writeJob(j);
  if (approve) await store.setApproval({ pieceId, jobId: j.id, inputVersion: "v1", outputRel: j.outputRel!, audioSig: audioKind, approvedAt: new Date().toISOString() });
  return j;
}

describe("share gating", () => {
  it("refuses to share an UNAPPROVED render", async () => {
    await readyApprovedJob("piece_unapp", "uploaded", false);
    const r = await share.createShare("piece_unapp");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Approve/);
  });

  it("refuses to share a PLACEHOLDER render even if a record exists", async () => {
    await readyApprovedJob("piece_ph", "placeholder", false);
    const r = await share.createShare("piece_ph");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/placeholder/i);
  });

  it("shares an APPROVED render: bound object key + hash + token (no byte copy)", async () => {
    await readyApprovedJob("piece_ok", "uploaded", true);
    const r = await share.createShare("piece_ok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.share.token).toMatch(/^[0-9a-f]{36}$/);
      expect(r.share.videoHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.share.videoKey).toMatch(/^content-studio\/.+\.mp4$/); // the link references a store key
      const meta = await getArtifactStore().getMeta(r.share.videoKey); // and the bytes are in the store
      expect(meta?.size).toBeGreaterThan(0);
      expect(meta?.sha256).toBe(r.share.videoHash);
    }
  });
});

describe("immutability + revocation", () => {
  it("regenerating the piece does NOT change what an existing link shows", async () => {
    await readyApprovedJob("piece_imm", "uploaded", true);
    const r = await share.createShare("piece_imm");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const boundBefore = await getArtifactStore().readFull(r.share.videoKey);
    // "Regenerate": a NEW ready job with a different version + different bytes (never shared).
    const out2 = path.join(DIR, "piece_imm-out2.mp4"); mp4(out2, 2);
    await store.writeJob(job({ id: "job2", pieceId: "piece_imm", outputFile: out2, inputVersion: "v2" }));
    const boundAfter = await getArtifactStore().readFull(r.share.videoKey);
    expect(boundAfter!.equals(boundBefore!)).toBe(true); // link's bound key still serves the ORIGINAL video
  });

  it("revoke disables the link", async () => {
    await readyApprovedJob("piece_rev", "uploaded", true);
    const r = await share.createShare("piece_rev");
    if (!r.ok) throw new Error("setup");
    expect(share.isLive(await share.getShare(r.share.token))).toBe(true);
    await share.revokeShare(r.share.token);
    expect(share.isLive(await share.getShare(r.share.token))).toBe(false);
  });
});

describe("prepared email", () => {
  it("links to the viewing page and NEVER attaches an mp4 or embeds a player", async () => {
    await readyApprovedJob("piece_mail", "uploaded", true);
    const r = await share.createShare("piece_mail");
    if (!r.ok) throw new Error("setup");
    const email = share.buildShareEmail(r.share, { baseUrl: "https://outreach.example.com" });
    expect(email.viewUrl).toBe(`https://outreach.example.com/v/${r.share.token}`);
    expect(email.html).toContain(email.viewUrl);
    expect(email.html).toContain("Watch your video review");
    expect(email.html).not.toMatch(/<video/i); // no embedded player
    expect(email.html).not.toMatch(/\.mp4/i); // no mp4 link/attachment
    expect(email.text).toContain(email.viewUrl);
  });
});

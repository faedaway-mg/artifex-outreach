// Full draft → approve → dispatch flow against an ISOLATED store + a NON-DELIVERING transport. No real
// email is sent; the video-artifact policy is enforced at dispatch. (The live Acquisition OS wiring is a
// handoff to the manual-email owner — this proves the CS-side contract end to end.)
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RenderJob } from "./types";

let DIR: string, store: typeof import("./store"), share: typeof import("./share"), drafts: typeof import("./draft-store");
const ctx = { suppressed: false, paused: false, authorized: true, quotaRemaining: 5, businessId: "biz1" };

function mp4(file: string) { execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=1", "-c:v", "libx264", "-t", "1", "-pix_fmt", "yuv420p", file], { stdio: "ignore" }); }
function job(p: Partial<RenderJob>): RenderJob {
  const now = new Date().toISOString();
  return { id: p.id!, pieceId: p.pieceId!, inputVersion: "v1", status: "ready", progress: 1, stage: "", mode: "uploaded-vo",
    audioKind: "uploaded", audioFile: null, audioLabel: null, outputFile: p.outputFile ?? null, outputRel: "/content/x.mp4",
    thumbRel: null, error: null, attempt: 1, pid: null, createdAt: now, updatedAt: now, startedAt: now, finishedAt: now };
}

beforeAll(async () => {
  DIR = mkdtempSync(path.join(tmpdir(), "cs-draftflow-"));
  vi.stubEnv("CONTENT_STUDIO_DATA_DIR", DIR);
  store = await import("./store"); share = await import("./share"); drafts = await import("./draft-store");
});
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); vi.unstubAllEnvs(); });

async function approvedShare(businessId = "biz1") {
  const out = path.join(DIR, `${businessId}.mp4`); mp4(out);
  const j = job({ id: `job_${businessId}`, pieceId: `client-${businessId}`, outputFile: out });
  await store.writeJob(j);
  await store.setApproval({ pieceId: j.pieceId, jobId: j.id, inputVersion: "v1", outputRel: j.outputRel!, audioSig: "uploaded", approvedAt: new Date().toISOString() });
  const r = await share.createShare(j.pieceId);
  if (!r.ok) throw new Error("share setup: " + r.error);
  return r.share;
}

describe("draft → approve → dispatch (non-delivering)", () => {
  it("prepares a draft bound to business + share + version", async () => {
    const s = await approvedShare("biz1");
    const r = await drafts.prepareDraft({ businessId: "biz1", shareToken: s.token, baseUrl: "https://x.test" });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.draft.businessId).toBe("biz1"); expect(r.draft.shareToken).toBe(s.token); expect(r.draft.inputVersion).toBe(s.inputVersion); expect(r.draft.approvedAt).toBeNull(); }
  });

  it("blocks dispatch before approval; sends (records) after approval; writes history", async () => {
    const s = await approvedShare("biz2");
    const p = await drafts.prepareDraft({ businessId: "biz2", shareToken: s.token, baseUrl: "https://x.test" });
    if (!p.ok) throw new Error();
    const before = await drafts.dispatchDraft(p.draft.id, { ...ctx, businessId: "biz2" });
    expect(before.ok).toBe(false); // not approved yet

    await drafts.approveDraft(p.draft.id);
    const after = await drafts.dispatchDraft(p.draft.id, { ...ctx, businessId: "biz2" });
    expect(after.ok).toBe(true);
    if (after.ok) { expect(after.result.delivered).toBe(false); expect(after.result.sharedVersion).toBe("v1"); } // recorded, NOT sent
  });

  it("revoking the share clears approval and blocks dispatch (no broken link, no bare-email fallback)", async () => {
    const s = await approvedShare("biz3");
    const p = await drafts.prepareDraft({ businessId: "biz3", shareToken: s.token, baseUrl: "https://x.test" });
    if (!p.ok) throw new Error();
    await drafts.approveDraft(p.draft.id);
    await share.revokeShare(s.token);
    const reconciled = await drafts.reconcileDraft(p.draft.id);
    expect(reconciled?.approvedAt).toBeNull(); // approval invalidated by revoke
    const d = await drafts.dispatchDraft(p.draft.id, { ...ctx, businessId: "biz3" });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.blockers.join()).toMatch(/revoked|not approved/);
  });

  it("enforces suppression / quota / business binding at dispatch", async () => {
    const s = await approvedShare("biz4");
    const p = await drafts.prepareDraft({ businessId: "biz4", shareToken: s.token, baseUrl: "https://x.test" });
    if (!p.ok) throw new Error();
    await drafts.approveDraft(p.draft.id);
    expect((await drafts.dispatchDraft(p.draft.id, { ...ctx, businessId: "biz4", suppressed: true })).ok).toBe(false);
    expect((await drafts.dispatchDraft(p.draft.id, { ...ctx, businessId: "biz4", quotaRemaining: 0 })).ok).toBe(false);
    expect((await drafts.dispatchDraft(p.draft.id, { ...ctx, businessId: "other" })).ok).toBe(false); // recipient ≠ bound business
  });
});

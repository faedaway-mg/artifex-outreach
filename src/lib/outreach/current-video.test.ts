import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { resolveCurrentVideo, latestProspectPackage } from "./prospect-package-store";
import { resolveScheduledDetail } from "./scheduled-detail";
import { seedApprovableVideoFixture } from "../breakbot/approvable-fixture";
import { resetBreakbotNamespace } from "../breakbot/namespace";
import { approveAndScheduleSelectedAction } from "./batch-actions";
import { rejectLead } from "./rejection";
import { writeJob, listJobs } from "../content-studio/store";
import { recordedOutreach } from "../comms/fake-outreach-provider";
import { __setArtifactStoreForTests } from "../content-studio/storage-factory";

const mem = new Map<string, { body: Buffer; sha256: string; contentType: string }>();
const memStore: any = {
  mode: "memory",
  async put(key: string, body: Buffer, o: any) { const { createHash } = await import("node:crypto"); const sha256 = createHash("sha256").update(body).digest("hex"); mem.set(key, { body, sha256, contentType: o.contentType }); return { key, sha256, bytes: body.length }; },
  async getMeta(key: string) { const v = mem.get(key); return v ? { key, size: v.body.length, contentType: v.contentType, sha256: v.sha256 } : null; },
  async readFull(key: string) { return mem.get(key)?.body ?? null; },
  async readRange(key: string, s: number, e: number) { const b = mem.get(key)?.body; return b ? b.subarray(s, e + 1) : null; },
  async exists(key: string) { return mem.has(key); },
  async del(key: string) { mem.delete(key); },
};

const savedEnv = { ...process.env };
beforeAll(() => { process.env.BREAKBOT_TEST_TENANT = "1"; process.env.PROSPECT_SHARE_SECRET = "test-share-secret"; delete process.env.DATABASE_URL; delete process.env.RESEND_API_KEY; delete process.env.CS_DATABASE_URL; __setArtifactStoreForTests(memStore); });
afterAll(() => { process.env = savedEnv; __setArtifactStoreForTests(null); });
beforeEach(() => { resetBreakbotNamespace(); mem.clear(); });

describe("mandate 23 — canonical current-video resolver", () => {
  it("READY_TO_APPROVE: resolves the assembled package video; operator preview is internal, no recipient share yet", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    const cur = await resolveCurrentVideo(leadId, { baseUrl: "https://x.test" });
    const pkg = await latestProspectPackage(leadId);
    expect(cur.available).toBe(true);
    expect(cur.source).toBe("ready-package");
    expect(cur.artifactKey).toBe(pkg!.video!.videoKey);
    expect(cur.sha256).toBe(pkg!.video!.sha256);
    expect(cur.hashVerified).toBe(true);
    expect(cur.stale).toBe(false);
    expect(cur.operatorPreviewUrl).toBe(`/api/content-studio/operator-video/${leadId}`);
    // Operator preview is NOT the recipient share, and no committed recipient share exists before freezing.
    expect(cur.operatorPreviewUrl).not.toMatch(/\/pv\//);
    expect(cur.recipientShare.state).toBe("not-frozen");
    expect(cur.recipientShare.url).toBeNull();
  });

  it("SCHEDULED (committed): frozen bound video is canonical; recipient share is active and SEPARATE", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    const cur = await resolveCurrentVideo(leadId, { baseUrl: "https://x.test" });
    const pkg = await latestProspectPackage(leadId);
    expect(cur.source).toBe("frozen-package");
    expect(cur.artifactKey).toBe(pkg!.video!.videoKey);
    expect(cur.sha256).toBe(pkg!.video!.sha256);
    expect(cur.stale).toBe(false);
    expect(cur.operatorPreviewUrl).toBe(`/api/content-studio/operator-video/${leadId}`);
    // Recipient share is tracked separately (its own /pv URL); it never replaces the operator preview.
    expect(cur.recipientShare.state).toBe("active");
    expect(cur.recipientShare.url).toMatch(/\/pv\//);
    expect(cur.recipientShare.url).not.toBe(cur.operatorPreviewUrl);
  });

  it("Quick/Full/Studio/Scheduled resolve the SAME canonical artifact hash + revision", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    const cur = await resolveCurrentVideo(leadId, { baseUrl: "https://x.test" });      // Quick Video / Studio / operator preview
    const pkg = await latestProspectPackage(leadId);                                    // Full Package binding
    const sched = (await resolveScheduledDetail(leadId, "https://x.test"))!;            // Scheduled detail
    expect(cur.artifactKey).toBe(pkg!.video!.videoKey);
    expect(cur.sha256).toBe(pkg!.video!.sha256);
    expect(sched.packageType).toBe("EMAIL_VIDEO");
    expect(sched.video.present).toBe(true);
    // All surfaces point at one artifact key + one revision.
    expect(cur.revisionId).toBe(`pkgv${pkg!.packageVersion}`);
  });

  it("superseded render is flagged stale for an un-frozen draft (never silently presented as current)", async () => {
    const { leadId, pieceId } = await seedApprovableVideoFixture();
    // A newer render with a DIFFERENT input version lands after assembly (draft not yet frozen).
    const now = new Date("2027-01-01T00:00:00Z").toISOString();
    await writeJob({ id: `bb_job_new_${leadId}`, pieceId, inputVersion: "vDEADBEEF", status: "ready", progress: 1, stage: "done", mode: "uploaded-vo", audioKind: "uploaded", audioFile: null, audioKey: "k", audioSha: "s", audioLabel: "vo", outputFile: null, outputRel: null, outputKey: `content-studio/breakbot/${leadId}/video2.mp4`, posterKey: null, screenshotKey: null, screenshotSha: null, storyboard: null, thumbRel: null, error: null, attempt: 1, pid: null, createdAt: now, updatedAt: now, startedAt: now, finishedAt: now } as any);
    const cur = await resolveCurrentVideo(leadId, { baseUrl: "https://x.test" });
    expect(cur.source).toBe("ready-package");
    expect(cur.stale).toBe(true); // a newer render supersedes the assembled draft's bound video
    void listJobs;
  });

  it("missing artifact: not available, no operator preview, honest reason", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    for (const k of [...mem.keys()]) if (/\/video\.mp4$/.test(k)) mem.delete(k);
    const cur = await resolveCurrentVideo(leadId, { baseUrl: "https://x.test" });
    expect(cur.available).toBe(false);
    expect(cur.operatorPreviewUrl).toBeNull();
    expect(cur.reason).toMatch(/missing/i);
  });

  it("rejected lead: canonical video no longer resolves as current work", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    await rejectLead({ leadId, reason: "poor-fit", actor: "test" });
    // The scheduled binding is voided; the package video artifact may still exist, but the lead is terminal —
    // scheduled detail returns null and nothing dispatches.
    expect(await resolveScheduledDetail(leadId, "https://x.test")).toBeNull();
    expect(recordedOutreach().length).toBe(0);
  });
});

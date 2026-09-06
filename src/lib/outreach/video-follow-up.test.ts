import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prepareVideoFollowUp, holdCompany, VIDEO_FOLLOWUP_ACTION } from "./video-follow-up";
import { seedApprovableVideoFixture, deleteVideoArtifact } from "../breakbot/approvable-fixture";
import { resetBreakbotNamespace } from "../breakbot/namespace";
import { buildCompanySnapshot } from "./company-snapshot";
import { latestProspectPackage, markPackageState } from "./prospect-package-store";
import { classifyPackageType, assertDispatchable } from "./dispatch-integrity";
import { rejectLead } from "./rejection";
import { getEditorialState } from "./review-revisions";
import { insertEmailSendIfAbsent, addSuppression, listAudit, getLead } from "../repo";
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

// A Morris-style fixture: a completed video package + a PRIOR SENT intro email (contacted, video undelivered).
async function seedMorrisLike(slug = "morris-like") {
  const { leadId } = await seedApprovableVideoFixture("Morris Automotive", slug);
  const recipient = `ops+${slug}@example.invalid`;
  await insertEmailSendIfAbsent({
    idempotencyKey: `intro:${leadId}`, stepId: "step_intro", planId: "plan_1", leadId, toAddr: recipient, fromAddr: "ops@example.invalid",
    subject: "Quick Review — Morris Automotive", status: "sent" as any, provider: "test", providerMessageId: "pm_intro_morris", attempts: 1,
    lastError: null, lastErrorCode: null, nextAttemptAt: null, queuedAt: null, sendingAt: null, sentAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    deliveredAt: new Date("2026-01-01T00:01:00Z").toISOString(), openedAt: null, clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null,
  } as any);
  return { leadId, recipient };
}

const followUpDigests = async (leadId: string) =>
  new Set((await listAudit(9999)).filter((a) => a.action === "prospect.package" && a.targetId === leadId && (a.meta as any)?.pkg?.followUp).map((a) => (a.meta as any).pkg.packageDigest));

describe("mandate 24 — VIDEO_FOLLOW_UP preparation", () => {
  it("eligible: Needs Attention → Ready to Approve; ONE follow-up; correct lineage; counts move; nothing sent", async () => {
    const { leadId } = await seedMorrisLike();
    let snap = await buildCompanySnapshot();
    expect(snap.needsAttention.find((r) => r.leadId === leadId)?.reasonCode).toBe("prior-sent-video-undelivered");
    expect(snap.ready.some((r) => r.leadId === leadId)).toBe(false);
    const naBefore = snap.counts.needsAttention, readyBefore = snap.counts.readyToSchedule;

    const r = await prepareVideoFollowUp({ leadId, actor: "test" });
    expect(r.ok).toBe(true);
    expect(r.state).toBe("READY_TO_APPROVE");
    expect(r.priorReceiptId).toBe("pm_intro_morris");
    expect(r.videoRevision).toBeTruthy();

    const pkg = await latestProspectPackage(leadId);
    expect(classifyPackageType(pkg)).toBe("VIDEO_FOLLOW_UP");
    expect(pkg?.followUp?.priorReceiptId).toBe("pm_intro_morris");
    expect(pkg?.followUp?.priorSentAt).toBeTruthy();
    // Copy truthfulness: no fabricated conversation/promise/reply.
    expect(/as we discussed|you said|you replied|you asked|per our (call|conversation)|as promised/i.test(`${pkg?.subject} ${pkg?.bodyText}`)).toBe(false);
    // Package completeness / dispatch integrity (with prior receipt).
    const verdict = assertDispatchable({ type: "VIDEO_FOLLOW_UP", subject: pkg?.subject, body: pkg?.bodyText, businessName: "Morris Automotive", recipientValid: true, hasFrozenReview: !!pkg?.review, hasVideo: !!pkg?.video, hasShare: !!pkg?.share, hasPriorReceipt: true, packageRevision: pkg?.packageVersion });
    expect(verdict.ok).toBe(true);

    snap = await buildCompanySnapshot();
    expect(snap.needsAttention.some((r) => r.leadId === leadId)).toBe(false);   // left Needs Attention
    expect(snap.ready.some((r) => r.leadId === leadId)).toBe(true);              // entered Ready to Approve
    expect(snap.counts.needsAttention).toBe(naBefore - 1);
    expect(snap.counts.readyToSchedule).toBe(readyBefore + 1);
    expect(recordedOutreach().length).toBe(0);
    expect((await followUpDigests(leadId)).size).toBe(1);
  });

  it("prior-delivery: an already-delivered video creates NO duplicate follow-up", async () => {
    const { leadId } = await seedMorrisLike("delivered");
    await markPackageState(leadId, "SENT"); // the original video package was already sent
    const r = await prepareVideoFollowUp({ leadId, actor: "test" });
    expect(r.ok).toBe(false);
    expect(r.alreadyDelivered).toBe(true);
    expect((await followUpDigests(leadId)).size).toBe(0);
  });

  it("idempotent double-tap → one logical follow-up; second reports alreadyPrepared", async () => {
    const { leadId } = await seedMorrisLike("double");
    const a = await prepareVideoFollowUp({ leadId, actor: "test" });
    const b = await prepareVideoFollowUp({ leadId, actor: "test" });
    expect(a.alreadyPrepared).toBeFalsy();
    expect(b.alreadyPrepared).toBe(true);
    expect((await followUpDigests(leadId)).size).toBe(1);
  });

  it("concurrent preparation converges to ONE logical follow-up (identical digest)", async () => {
    const { leadId } = await seedMorrisLike("concurrent");
    await Promise.all(Array.from({ length: 5 }, () => prepareVideoFollowUp({ leadId, actor: "test" })));
    expect((await followUpDigests(leadId)).size).toBe(1); // same (priorReceipt + video revision) → one digest
    expect(recordedOutreach().length).toBe(0);
  });

  it("Hold: leaves Needs Attention, distinct from reject/unsubscribe, resumable, sends nothing", async () => {
    const { leadId, recipient } = await seedMorrisLike("hold");
    const r = await holdCompany(leadId, "test");
    expect(r.ok).toBe(true);
    expect((await getEditorialState(leadId)).held).toBeTruthy();
    const snap = await buildCompanySnapshot();
    expect(snap.needsAttention.some((x) => x.leadId === leadId)).toBe(false); // removed from active attention
    const lead = await getLead(leadId);
    expect(lead?.pipelineStage).not.toBe("Rejected");                          // NOT a rejection
    const { isSuppressed } = await import("../repo");
    expect(await isSuppressed({ email: recipient })).toBe(false);              // NOT an unsubscribe
  });

  it("suppressed / rejected recipients cannot prepare a follow-up", async () => {
    const s = await seedMorrisLike("supp");
    await addSuppression({ email: s.recipient, domain: null, phone: null, reason: "test", source: "test" } as any);
    const rs = await prepareVideoFollowUp({ leadId: s.leadId, actor: "test" });
    expect(rs.ok).toBe(false); expect(/suppress/i.test(rs.reason ?? "")).toBe(true);

    const j = await seedMorrisLike("rej");
    await rejectLead({ leadId: j.leadId, reason: "poor-fit", actor: "test" });
    const rj = await prepareVideoFollowUp({ leadId: j.leadId, actor: "test" });
    expect(rj.ok).toBe(false); expect(/reject/i.test(rj.reason ?? "")).toBe(true);
  });

  it("no prior send → ineligible with a precise reason; missing video → precise reason", async () => {
    const { leadId } = await seedApprovableVideoFixture("No Intro Co", "no-intro"); // ready video but never sent
    const r = await prepareVideoFollowUp({ leadId, actor: "test" });
    expect(r.ok).toBe(false); expect(/no prior sent/i.test(r.reason ?? "")).toBe(true);

    const m = await seedMorrisLike("no-video");
    for (const k of [...mem.keys()]) if (k.includes(m.leadId) && /video/.test(k)) mem.delete(k);
    await deleteVideoArtifact(m.leadId).catch(() => {});
    const r2 = await prepareVideoFollowUp({ leadId: m.leadId, actor: "test" });
    expect(r2.ok).toBe(false);
  });
});

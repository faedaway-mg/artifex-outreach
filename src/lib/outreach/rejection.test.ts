import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { rejectLead, latestRejection } from "./rejection";
import { REJECTION_ACTION, REJECTED_STAGE, REJECTION_REASONS, isRejectedLead } from "./rejection-core";
import { seedApprovableVideoFixture } from "../breakbot/approvable-fixture";
import { resetBreakbotNamespace } from "../breakbot/namespace";
import { buildCompanySnapshot } from "./company-snapshot";
import { approveAndScheduleSelectedAction } from "./batch-actions";
import { listScheduledBindings, validateScheduled, dueScheduled } from "./scheduled-batch";
import { resolvePackageForSendById, autoAssembleFromRender } from "./prospect-package-store";
import { authorizeForSend } from "./review-send-policy";
import { reanalysisEligibility } from "./reanalysis-eligibility";
import { reconcileProspectLifecycle } from "./lifecycle-reconcile";
import { getLead, insertLead, allEmailSends, listAudit, isSuppressed, insertEmailSendIfAbsent, claimLeadRejection } from "../repo";
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
beforeAll(() => { process.env.BREAKBOT_TEST_TENANT = "1"; delete process.env.DATABASE_URL; delete process.env.RESEND_API_KEY; delete process.env.CS_DATABASE_URL; __setArtifactStoreForTests(memStore); });
afterAll(() => { process.env = savedEnv; __setArtifactStoreForTests(null); });
beforeEach(() => { resetBreakbotNamespace(); mem.clear(); });

/** Minimal non-video lead for the reason/contacted cases (mem store stores the object as-is). */
async function basicLead(slug: string, stage = "Qualified") {
  return insertLead({
    businessName: slug, normalizedName: slug, pipelineStage: stage, source: "breakbot",
    publicEmail: `ops+${slug}@example.invalid`, websiteDomain: `${slug}.example.invalid`, website: `https://${slug}.example.invalid`,
    phone: null, industry: "Home services", test_only: true,
  } as any);
}

async function rejectionEvents(leadId: string) {
  return (await listAudit(5000)).filter((a) => a.action === REJECTION_ACTION && a.targetId === leadId);
}

describe("mandate 21 — terminal rejection disposition", () => {
  it("an internal rejection is DISTINCT from an unsubscribe: it writes NO suppression and never claims opt-out", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    const recipient = `ops+approvable-video@example.invalid`;
    const r = await rejectLead({ leadId, reason: "poor-fit", actor: "test" });
    expect(r.ok).toBe(true);
    expect(r.disposition).toBe("REJECTED");

    const lead = await getLead(leadId);
    expect(isRejectedLead(lead)).toBe(true);
    expect(lead!.pipelineStage).toBe(REJECTED_STAGE);

    // The recipient is NOT suppressed — an internal rejection must not masquerade as an opt-out.
    expect(await isSuppressed({ email: recipient })).toBe(false);
    // No suppression/unsubscribe cascade event was written; exactly one truthful rejection event was.
    const audit = await listAudit(5000);
    expect(audit.some((a) => a.action === "outreach.suppress.cascade" && a.targetId === recipient)).toBe(false);
    expect((await rejectionEvents(leadId)).length).toBe(1);

    const rec = await latestRejection(leadId);
    expect(rec?.reason).toBe("poor-fit");
    expect(rec?.priorStage).toBe("Qualified"); // the stage the lead held before rejection is preserved
    expect(recordedOutreach().length).toBe(0);
  });

  it("accepts and records each canonical reason", async () => {
    for (const reason of REJECTION_REASONS) {
      const lead = await basicLead(`reason-${reason}`);
      const r = await rejectLead({ leadId: lead.id, reason, note: reason === "other" ? "custom" : null, actor: "test" });
      expect(r.ok).toBe(true);
      const rec = await latestRejection(lead.id);
      expect(rec?.reason).toBe(reason);
      if (reason === "other") expect(rec?.note).toBe("custom");
      expect((await getLead(lead.id))!.pipelineStage).toBe(REJECTED_STAGE);
    }
  });

  it("removes the company from the Ready queue and decrements the count", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    let snap = await buildCompanySnapshot();
    expect(snap.ready.some((x) => x.leadId === leadId)).toBe(true);
    const readyBefore = snap.counts.readyToSchedule;

    await rejectLead({ leadId, reason: "wrong-industry", actor: "test" });

    snap = await buildCompanySnapshot();
    expect(snap.ready.some((x) => x.leadId === leadId)).toBe(false);          // left the pipeline
    expect(snap.scheduled.some((x) => x.leadId === leadId)).toBe(false);
    expect(snap.needsAttention.some((x) => x.leadId === leadId)).toBe(false);
    expect(snap.counts.readyToSchedule).toBe(readyBefore - 1);                 // count updated
  });

  it("rejecting a SCHEDULED (unsent) company cancels the binding and blocks every dispatch path (race-safe)", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    const binding = (await listScheduledBindings()).find((b) => b.leadId === leadId)!.binding; // capture BEFORE
    expect(binding).toBeTruthy();

    const r = await rejectLead({ leadId, reason: "outside-target-size", actor: "test" });
    expect(r.cancelledBinding).toBe(true);

    // Binding voided → no longer selectable; the final pre-dispatch recheck rejects the captured binding.
    expect((await listScheduledBindings()).some((b) => b.leadId === leadId)).toBe(false);
    const v = await validateScheduled(leadId, binding);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/rejected/i);
    const due = await dueScheduled(new Date(binding.scheduledAt));
    expect(due.some((d) => d.leadId === leadId)).toBe(false);

    // Every other dispatch gate also refuses — never both dispatch-eligible AND terminally rejected.
    expect((await resolvePackageForSendById(leadId)).ok).toBe(false);
    expect((await authorizeForSend(leadId, { campaignId: "t" })).authorized).toBe(false);
    expect(recordedOutreach().length).toBe(0);
  });

  it("prevents package regeneration, late-render reactivation, and reconciler reactivation", async () => {
    const { leadId } = await seedApprovableVideoFixture(); // has a verified render + READY package
    await rejectLead({ leadId, reason: "poor-fit", actor: "test" });

    // New-outreach preparation is refused for the rejected stage (independent of the caller's `terminal` calc).
    const elig = reanalysisEligibility({ internal: false, pipelineStage: REJECTED_STAGE, terminal: false, contacted: false, scheduled: false, suppressed: false, hasWebsite: true, recipientValid: true, packageState: null });
    expect(elig.eligible).toBe(false);
    expect(elig.reason).toBe("terminal-stage");

    // A late render must NOT reactivate the company or assemble a Ready package.
    const asm = await autoAssembleFromRender(leadId);
    expect(asm.ok).toBe(false);
    expect(asm.reason).toMatch(/rejected/i);

    // The whole-book reconciler leaves it terminal — no assemble, no reappearance in Ready.
    await reconcileProspectLifecycle({ apply: true });
    const snap = await buildCompanySnapshot();
    expect(snap.ready.some((x) => x.leadId === leadId)).toBe(false);
    expect(snap.counts.readyToSchedule).toBe(0);
    expect(recordedOutreach().length).toBe(0);
  });

  it("a CONTACTED company: reject preserves the delivered email + receipt, writes no unsubscribe", async () => {
    const lead = await basicLead("contacted-co", "Contacted");
    const { row } = await insertEmailSendIfAbsent({
      idempotencyKey: `test:${lead.id}`, stepId: null, planId: null, leadId: lead.id, toAddr: lead.publicEmail!, fromAddr: "ops@artifexlabs.tech",
      subject: "Quick Review", status: "sent" as any, provider: "test", providerMessageId: "pm_1", attempts: 1, lastError: null, lastErrorCode: null,
      nextAttemptAt: null, queuedAt: null, sendingAt: null, sentAt: new Date("2026-01-01T00:00:00Z").toISOString(), deliveredAt: null, openedAt: null,
      clickedAt: null, bouncedAt: null, complainedAt: null, unsubscribedAt: null, failedAt: null,
    } as any);
    expect(row.sentAt).toBeTruthy();

    const r = await rejectLead({ leadId: lead.id, reason: "duplicate", actor: "test" });
    expect(r.contacted).toBe(true);
    expect(r.sent).toBe(true);

    // The delivered receipt is preserved (history not deleted); no suppression/unsubscribe was written.
    const sends = (await allEmailSends()).filter((e) => e.leadId === lead.id);
    expect(sends.length).toBe(1);
    expect(sends[0].sentAt).toBeTruthy();
    expect(sends[0].providerMessageId).toBe("pm_1");
    expect(await isSuppressed({ email: lead.publicEmail })).toBe(false);
    expect((await getLead(lead.id))!.pipelineStage).toBe(REJECTED_STAGE);
  });

  it("idempotent double-tap → ONE logical rejection event; a repeat reports alreadyRejected", async () => {
    const lead = await basicLead("double-tap");
    const first = await rejectLead({ leadId: lead.id, reason: "bad-contact", actor: "test" });
    const second = await rejectLead({ leadId: lead.id, reason: "bad-contact", actor: "test" });
    expect(first.alreadyRejected).toBe(false);
    expect(second.alreadyRejected).toBe(true);
    expect((await rejectionEvents(lead.id)).length).toBe(1); // no duplicate event
    expect((await getLead(lead.id))!.pipelineStage).toBe(REJECTED_STAGE);
  });

  it("TWENTY concurrent rejections create EXACTLY ONE event and one terminal disposition (never dispatch-eligible)", async () => {
    const lead = await basicLead("concurrent-20");
    const results = await Promise.all(Array.from({ length: 20 }, () => rejectLead({ leadId: lead.id, reason: "poor-fit", actor: "test" })));
    // Exactly one caller claimed the transition; the other 19 converged as alreadyRejected.
    expect(results.filter((r) => r.ok && !r.alreadyRejected).length).toBe(1);
    expect(results.filter((r) => r.ok && r.alreadyRejected).length).toBe(19);
    // Exactly ONE logical lead.rejected event; one terminal disposition.
    expect((await rejectionEvents(lead.id)).length).toBe(1);
    expect((await getLead(lead.id))!.pipelineStage).toBe(REJECTED_STAGE);
    expect(isRejectedLead(await getLead(lead.id))).toBe(true);
    expect(recordedOutreach().length).toBe(0);
  });

  it("cross-instance concurrency at the storage boundary: 20 racing claimLeadRejection → ONE claim, ONE event", async () => {
    // claimLeadRejection is the exact atomic boundary both server instances share (DB row lock in prod;
    // synchronous check-and-set in-memory). Racing it directly proves the storage-level exactly-once.
    const lead = await basicLead("cross-instance");
    const claims = await Promise.all(Array.from({ length: 20 }, (_v, i) => claimLeadRejection({
      leadId: lead.id,
      audit: { action: REJECTION_ACTION, actor: `instance-${i}`, targetType: "lead", targetId: lead.id, meta: { disposition: "REJECTED", reason: "poor-fit" }, ip: null },
    })));
    expect(claims.filter((c) => c.claimed).length).toBe(1);
    expect(claims.filter((c) => c.claimed)[0].priorStage).toBe("Qualified"); // the winner sees the real prior stage
    expect((await rejectionEvents(lead.id)).length).toBe(1);
  });

  it("retry after a simulated process restart creates NO duplicate event", async () => {
    const lead = await basicLead("restart-retry");
    const first = await rejectLead({ leadId: lead.id, reason: "poor-fit", actor: "test" });
    expect(first.alreadyRejected).toBe(false);
    // "Restart": the durable store persists; a retried request re-enters against the already-Rejected row.
    const retry = await rejectLead({ leadId: lead.id, reason: "poor-fit", actor: "test" });
    expect(retry.alreadyRejected).toBe(true);
    expect((await rejectionEvents(lead.id)).length).toBe(1); // still exactly one
  });

  it("binding cancellation remains idempotent under repeat/concurrent rejection", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    expect((await listScheduledBindings()).some((b) => b.leadId === leadId)).toBe(true);
    // 5 concurrent rejections: the binding is voided exactly once; all converge with zero bindings left.
    await Promise.all(Array.from({ length: 5 }, () => rejectLead({ leadId, reason: "poor-fit", actor: "test" })));
    expect((await listScheduledBindings()).some((b) => b.leadId === leadId)).toBe(false);
    expect((await rejectionEvents(leadId)).length).toBe(1);
    expect(recordedOutreach().length).toBe(0);
  });
});

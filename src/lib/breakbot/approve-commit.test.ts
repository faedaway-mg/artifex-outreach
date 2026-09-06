import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { seedApprovableVideoFixture } from "./approvable-fixture";
import { resetBreakbotNamespace } from "./namespace";
import { buildCompanySnapshot } from "../outreach/company-snapshot";
import { approveAndScheduleSelectedAction } from "../outreach/batch-actions";
import { listScheduledBindings, validateScheduled, dueScheduled } from "../outreach/scheduled-batch";
import { allEmailSends, listAudit, addSuppression } from "../repo";
import { latestProspectPackage } from "../outreach/prospect-package-store";
import { recordedOutreach } from "../comms/fake-outreach-provider";
import { __setArtifactStoreForTests } from "../content-studio/storage-factory";

// A minimal in-memory ArtifactStore so the test never touches the filesystem or a real provider.
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

describe("mandate 20B — REAL canonical approve & schedule (Ready → Scheduled)", () => {
  it("seeds an approvable package, then the REAL action commits the complete transition", async () => {
    const { leadId, packageVersion } = await seedApprovableVideoFixture();
    void packageVersion;

    // Appears exactly once in Ready; zero bindings; zero sends.
    let snap = await buildCompanySnapshot();
    expect(snap.ready.filter((r) => r.leadId === leadId)).toHaveLength(1);
    expect((await listScheduledBindings()).length).toBe(0);
    const sendsBefore = (await allEmailSends()).length;

    // THE REAL canonical operation (same one the UI button calls).
    const res = await approveAndScheduleSelectedAction([leadId]);
    const one = res.results.find((r) => r.leadId === leadId);
    expect(one?.ok).toBe(true);
    expect(res.batchId).toBeTruthy();

    // Postconditions: exactly one binding, frozen revision, leaves Ready, audit, dry-run, zero sends.
    const bindings = await listScheduledBindings();
    expect(bindings.filter((b) => b.leadId === leadId)).toHaveLength(1);
    const binding = bindings.find((b) => b.leadId === leadId)!.binding;
    expect(binding.revisionId).toBeTruthy();
    expect((await validateScheduled(leadId, binding)).ok).toBe(true); // integrity gate passes (tenant allows provenance)

    snap = await buildCompanySnapshot();
    expect(snap.ready.filter((r) => r.leadId === leadId)).toHaveLength(0);   // removed from Ready
    expect(snap.scheduled.filter((s) => s.leadId === leadId)).toHaveLength(1); // exactly once in Scheduled

    const audit = await listAudit(5000);
    expect(audit.some((a) => a.action === "outreach.schedule.batch")).toBe(true);        // schedule audit
    expect(audit.some((a) => a.action === "prospect.package" && a.targetId === leadId)).toBe(true); // approval/freeze audit

    // Scheduler dry-run selects the binding at its due time; still nothing sent.
    const due = await dueScheduled(new Date(binding.scheduledAt));
    expect(due.some((d) => d.leadId === leadId)).toBe(true);
    expect((await allEmailSends()).length).toBe(sendsBefore);   // zero email sends created
    expect(recordedOutreach().length).toBe(0);                  // zero fake-provider calls (no runner invoked)
  });

  it("idempotency: a second approval (double-tap) yields ONE binding, no duplicate", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    await approveAndScheduleSelectedAction([leadId]); // second click
    expect((await listScheduledBindings()).filter((b) => b.leadId === leadId)).toHaveLength(1);
    expect(recordedOutreach().length).toBe(0);
  });

  it("concurrent approvals converge to ONE binding (immutable artifact prevents a conflicting overwrite), zero sends", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    // Two REAL concurrent approvals. The immutable frozen-artifact store rejects a conflicting overwrite, so
    // at most one path commits the schedule — the net result is exactly ONE binding, never a duplicate.
    const settled = await Promise.allSettled([approveAndScheduleSelectedAction([leadId]), approveAndScheduleSelectedAction([leadId])]);
    expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
    expect((await listScheduledBindings()).filter((b) => b.leadId === leadId)).toHaveLength(1); // never 2
    const pkg = await latestProspectPackage(leadId);
    expect(pkg?.state === "FROZEN" || pkg?.state === "SCHEDULED").toBe(true);
    expect(recordedOutreach().length).toBe(0);
  });

  it("fault/recovery: a schedule failure yields NO binding + a coherent, retryable state (never false success)", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    const lead = (await buildCompanySnapshot()).ready.find((r) => r.leadId === leadId);
    expect(lead).toBeTruthy();
    // Inject a failure between preparation and schedule commit: the recipient becomes suppressed, so
    // scheduleBatch removes it AFTER the freeze prepared. No binding may be created.
    await addSuppression({ email: `ops+approvable-video@example.invalid`, domain: null, phone: null, reason: "test", source: "test" } as any);
    const res = await approveAndScheduleSelectedAction([leadId]);
    const one = res.results.find((r) => r.leadId === leadId);
    expect(one?.ok).toBe(false);                 // NOT approved → the UI must NOT show "Approved" (no false success)
    // Critical invariants: no orphan binding, no schedule-without-approval, no false-success in Scheduled.
    expect((await listScheduledBindings()).filter((b) => b.leadId === leadId)).toHaveLength(0);
    const snap = await buildCompanySnapshot();
    expect(snap.scheduled.some((s) => s.leadId === leadId)).toBe(false); // never a stale "scheduled" without a real binding
    expect(recordedOutreach().length).toBe(0);   // zero provider calls
  });
});

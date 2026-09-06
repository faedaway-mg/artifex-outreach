import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { resolveScheduledDetail } from "./scheduled-detail";
import { seedApprovableVideoFixture, seedScheduledEmailPdfFixture } from "../breakbot/approvable-fixture";
import { resetBreakbotNamespace } from "../breakbot/namespace";
import { approveAndScheduleSelectedAction } from "./batch-actions";
import { listScheduledBindings } from "./scheduled-batch";
import { rejectLead } from "./rejection";
import { insertLead } from "../repo";
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

describe("mandate 22 — package-aware Scheduled detail (frozen binding resolution)", () => {
  it("EMAIL_VIDEO: resolves video package, uses the frozen binding revision, no false quarantine", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    const binding = (await listScheduledBindings()).find((b) => b.leadId === leadId)!.binding;

    const d = (await resolveScheduledDetail(leadId, "https://x.test"))!;
    expect(d).toBeTruthy();
    expect(d.packageType).toBe("EMAIL_VIDEO");
    expect(d.revisionId).toBe(binding.revisionId);        // SAME revision the dispatch path uses
    expect(d.video.required && d.video.present).toBe(true);
    expect(d.pdf.required && d.pdf.present).toBe(true);
    expect(d.subject).toBeTruthy();
    expect(d.quarantined).toBe(false);
    expect(d.missing).toHaveLength(0);
    expect(d.validator.ok).toBe(true);
    expect(recordedOutreach().length).toBe(0);
  });

  it("EMAIL_PDF: renders email + PDF and does NOT require or warn about a video", async () => {
    const { leadId } = await seedScheduledEmailPdfFixture();
    const d = (await resolveScheduledDetail(leadId, "https://x.test"))!;
    expect(d.packageType).toBe("EMAIL_PDF");
    expect(d.pdf.required && d.pdf.present).toBe(true);
    expect(d.video.required).toBe(false);                 // no missing-video warning for an email package
    expect(d.quarantined).toBe(false);
    expect(d.subject).toBeTruthy();
    expect(d.bodyText).toBeTruthy();                       // real prepared outreach, not a placeholder
    expect(d.validator.ok).toBe(true);
  });

  it("a non-scheduled lead resolves to null (detail falls back to the normal view)", async () => {
    const lead = await insertLead({ businessName: "Not Scheduled Co", normalizedName: "nsc", pipelineStage: "Qualified", source: "breakbot", publicEmail: "ops+nsc@example.invalid", test_only: true } as any);
    expect(await resolveScheduledDetail(lead.id, "https://x.test")).toBeNull();
  });

  it("invalid missing-artifact binding: a video package whose video is gone is QUARANTINED (Needs Attention)", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    // Remove the video artifact AFTER scheduling — the binding still declares a video package.
    for (const k of [...mem.keys()]) if (/\/video\.mp4$/.test(k)) mem.delete(k);
    const d = (await resolveScheduledDetail(leadId, "https://x.test"))!;
    expect(d.packageType).toBe("EMAIL_VIDEO");             // still DECLARES a video package
    expect(d.video.present).toBe(false);
    expect(d.missing).toContain("video");
    expect(d.quarantined).toBe(true);                      // routes to Needs Attention, not a fake-complete view
  });

  it("a rejected scheduled company leaves the queue and its binding validation fails (quarantine-safe)", async () => {
    const { leadId } = await seedApprovableVideoFixture();
    await approveAndScheduleSelectedAction([leadId]);
    await rejectLead({ leadId, reason: "poor-fit", actor: "test" });
    // Binding voided by rejection → no scheduled detail remains.
    expect(await resolveScheduledDetail(leadId, "https://x.test")).toBeNull();
    expect(recordedOutreach().length).toBe(0);
  });
});

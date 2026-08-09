import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { allTasks, listLeads, getSettings, allMeetings, updateTask, allEmailSends } from "../repo";
import { createEmailTestLead, TEST_LEAD_NAME, TEST_LEAD_SOURCE } from "./email-test-lead";
import { buildWorkQueue, surfaceTodaysTasks, channelCapacity } from "../work-queue";

const OP = "jordan.ops@gmail.com"; // a realistic operator-controlled address (not a placeholder)

describe("internal email-test lead — real pipeline, safely isolated", () => {
  beforeEach(() => __resetStoreForTests());
  afterEach(() => { delete process.env.RESEND_FROM; });

  it("creates an email-first lead + review_and_send task that surfaces under Emails to send", async () => {
    const r = await createEmailTestLead(OP);
    expect(r.businessName).toBe(TEST_LEAD_NAME);
    expect(r.recipient).toBe(OP);

    const lead = (await listLeads()).find((l) => l.id === r.leadId)!;
    expect(lead.source).toBe(TEST_LEAD_SOURCE);
    expect(lead.publicEmail).toBe(OP);
    expect(lead.phone).toBeNull(); // email-first

    const tasks = (await allTasks()).filter((t) => t.leadId === r.leadId && t.status === "open");
    expect(tasks.filter((t) => t.type === "review_and_send")).toHaveLength(1);

    const leadMap = new Map([[lead.id, lead]]);
    const cats = buildWorkQueue({ tasks, meetingsToday: [], leads: leadMap });
    expect(cats.find((c) => c.kind === "email")?.leadIds).toContain(r.leadId);
  });

  it("is not starved by a full email queue (high priority keeps it visible)", async () => {
    const r = await createEmailTestLead(OP);
    const lead = (await listLeads()).find((l) => l.id === r.leadId)!;
    const tasks = (await allTasks()).filter((t) => t.status === "open");
    const leadMap = new Map((await listLeads()).map((l) => [l.id, l]));
    const surfaced = surfaceTodaysTasks({ tasks: tasks.sort((a, b) => b.priority - a.priority), leads: leadMap, capacity: channelCapacity({ emailTarget: 1, otherBudget: 0 }) });
    expect(surfaced.some((t) => t.leadId === lead.id)).toBe(true);
  });

  it("repeated presses BEFORE sending reuse the same pending lead — never a duplicate", async () => {
    const a = await createEmailTestLead(OP);
    const b = await createEmailTestLead("second.inbox@gmail.com");
    expect(b.reused).toBe(true);
    expect(b.leadId).toBe(a.leadId);
    expect((await listLeads()).filter((l) => l.source === TEST_LEAD_SOURCE)).toHaveLength(1);
    expect((await allTasks()).filter((t) => t.leadId === a.leadId && t.status === "open" && t.type === "review_and_send")).toHaveLength(1);
    expect((await listLeads()).find((l) => l.id === a.leadId)!.publicEmail).toBe("second.inbox@gmail.com");
  });

  it("rotates to a FRESH lead after the prior test was sent — history stays immutable", async () => {
    const a = await createEmailTestLead(OP);
    // Simulate the controlled send completing the review task (as EmailDecision does).
    await updateTask(a.taskId, { status: "done" });
    const b = await createEmailTestLead(OP);
    expect(b.reused).toBe(false); // a clean lead for the new run
    expect(b.leadId).not.toBe(a.leadId);
    // Exactly one ACTIVE test task (the new one); the old lead still exists (history intact).
    const openTestTasks = (await allTasks()).filter((t) => t.status === "open" && t.type === "review_and_send");
    expect(openTestTasks).toHaveLength(1);
    expect(openTestTasks[0].leadId).toBe(b.leadId);
    expect((await listLeads()).filter((l) => l.source === TEST_LEAD_SOURCE).length).toBe(2);
  });

  it("refuses an invalid recipient, a placeholder, or the sender address", async () => {
    await expect(createEmailTestLead("")).rejects.toThrow(/real email/i);
    await expect(createEmailTestLead("not-an-email")).rejects.toThrow(/real email/i);
    await expect(createEmailTestLead("someone@example.com")).rejects.toThrow(/real email/i); // placeholder
    await expect(createEmailTestLead("hello@artifexlabs.tech")).rejects.toThrow(/must NOT be the sender/i);
  });

  it("refuses the configured sender even when RESEND_FROM carries a display name", async () => {
    process.env.RESEND_FROM = "Artifex Labs <sender@artifexlabs.tech>";
    await expect(createEmailTestLead("sender@artifexlabs.tech")).rejects.toThrow(/must NOT be the sender/i);
    // a genuinely different operator address is still accepted
    const r = await createEmailTestLead(OP);
    expect(r.recipient).toBe(OP);
  });

  it("does not count as a real conversion (never reaches Won) and has no side effects", async () => {
    const r = await createEmailTestLead(OP);
    const lead = (await listLeads()).find((l) => l.id === r.leadId)!;
    expect(lead.pipelineStage).not.toBe("Won");
    expect(await getSettings()).toBeTruthy();
    expect(await allMeetings()).toEqual([]);
  });

  it("PREPARING the test sends nothing — no email-send ledger row is created", async () => {
    await createEmailTestLead(OP);
    expect(await allEmailSends()).toEqual([]); // creation never dispatches; the human sends
  });
});

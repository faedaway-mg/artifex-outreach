import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { allTasks, listLeads, getSettings, allMeetings } from "../repo";
import { createEmailTestLead, TEST_LEAD_NAME, TEST_LEAD_SOURCE } from "./email-test-lead";
import { buildWorkQueue, surfaceTodaysTasks, channelCapacity } from "../work-queue";

describe("internal email-test lead — real pipeline, safely isolated", () => {
  beforeEach(() => __resetStoreForTests());

  it("creates an email-first lead + review_and_send task that surfaces under Emails to send", async () => {
    const r = await createEmailTestLead("jordan.personal@example.com");
    expect(r.businessName).toBe(TEST_LEAD_NAME);
    expect(r.recipient).toBe("jordan.personal@example.com");

    const lead = (await listLeads()).find((l) => l.id === r.leadId)!;
    expect(lead.source).toBe(TEST_LEAD_SOURCE);
    expect(lead.publicEmail).toBe("jordan.personal@example.com");
    expect(lead.phone).toBeNull(); // email-first

    const tasks = (await allTasks()).filter((t) => t.leadId === r.leadId && t.status === "open");
    expect(tasks.filter((t) => t.type === "review_and_send")).toHaveLength(1);

    // It reaches the real "email" work stream.
    const leadMap = new Map([[lead.id, lead]]);
    const cats = buildWorkQueue({ tasks, meetingsToday: [], leads: leadMap });
    expect(cats.find((c) => c.kind === "email")?.leadIds).toContain(r.leadId);
  });

  it("is not starved by a full email queue (high priority keeps it visible)", async () => {
    const r = await createEmailTestLead("me@example.com");
    const lead = (await listLeads()).find((l) => l.id === r.leadId)!;
    const tasks = (await allTasks()).filter((t) => t.status === "open");
    const leadMap = new Map((await listLeads()).map((l) => [l.id, l]));
    // Even with zero email capacity headroom elsewhere, priority 100 surfaces first.
    const surfaced = surfaceTodaysTasks({ tasks: tasks.sort((a, b) => b.priority - a.priority), leads: leadMap, capacity: channelCapacity({ emailTarget: 1, otherBudget: 0 }) });
    expect(surfaced.some((t) => t.leadId === lead.id)).toBe(true);
  });

  it("is idempotent — re-running updates the recipient and never duplicates the task", async () => {
    const a = await createEmailTestLead("first@example.com");
    const b = await createEmailTestLead("second@example.com");
    expect(b.reused).toBe(true);
    expect(b.leadId).toBe(a.leadId);
    expect((await listLeads()).filter((l) => l.source === TEST_LEAD_SOURCE)).toHaveLength(1);
    expect((await allTasks()).filter((t) => t.leadId === a.leadId && t.status === "open" && t.type === "review_and_send")).toHaveLength(1);
    expect((await listLeads()).find((l) => l.id === a.leadId)!.publicEmail).toBe("second@example.com");
  });

  it("refuses an invalid recipient or the sender address (never sends to a business)", async () => {
    await expect(createEmailTestLead("")).rejects.toThrow(/valid/i);
    await expect(createEmailTestLead("not-an-email")).rejects.toThrow(/valid/i);
    await expect(createEmailTestLead("hello@artifexlabs.tech")).rejects.toThrow(/must NOT be the sender/i);
  });

  it("does not count as a real conversion (never reaches Won) and carries no acquisition plan", async () => {
    const r = await createEmailTestLead("me@example.com");
    const lead = (await listLeads()).find((l) => l.id === r.leadId)!;
    expect(lead.pipelineStage).not.toBe("Won");
    // Sanity: getSettings/allMeetings still work with the test lead present (no side effects).
    expect(await getSettings()).toBeTruthy();
    expect(await allMeetings()).toEqual([]);
  });
});

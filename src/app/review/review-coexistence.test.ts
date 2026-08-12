import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

// Content #001 / /review was written BEFORE route-aware reconciliation, whole-pool
// materializeRouting, and the email-inventory board shipped. These tests prove the held
// inbound work still composes with the CURRENT outbound architecture: the inbound request
// survives reconciliation intact and is never buried under routine prepared outbound.
import { __resetStoreForTests } from "@/lib/store";
import { insertLead, getLead, allTasks, listLeads } from "@/lib/repo";
import { makeLead } from "@/lib/test-lead";
import type { Lead, Task } from "@/lib/types";
import { requestReviewAction } from "./actions";
import { materializeRouting, findStrandedEmailLeads } from "@/lib/outreach/auto-route";
import { surfaceTodaysTasks, channelCapacity, emailInventory } from "@/lib/work-queue";
import { determineContactStrategy } from "@/lib/outreach/contact-strategy";

const open = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open");
const inboundLead = async () => (await listLeads()).find((l) => l.source?.startsWith("inbound-review"));

describe("Content #001 inbound coexists with current outbound reconciliation", () => {
  beforeEach(() => __resetStoreForTests());

  it("survives whole-pool materializeRouting intact — no duplicate, priority preserved, not stranded", async () => {
    await requestReviewAction({ businessName: "Requester LLC", website: "requester.com", email: "owner@requester.com", ref: "content-001" });
    const lead = (await inboundLead())!;
    expect(determineContactStrategy(lead).kind).toBe("email-first");
    const before = await open(lead.id);
    expect(before.filter((t) => t.type === "review_and_send")).toHaveLength(1);
    expect(before.find((t) => t.type === "review_and_send")!.priority).toBe(80);

    // The current reconciliation pass runs over the WHOLE pool (not just review placeholders).
    await materializeRouting();

    const after = await open(lead.id);
    expect(after.filter((t) => t.type === "review_and_send")).toHaveLength(1); // no duplicate
    expect(after.find((t) => t.type === "review_and_send")!.priority).toBe(80); // priority preserved
    expect(findStrandedEmailLeads({ leads: [await getLead(lead.id) as Lead], tasks: await allTasks() })).toHaveLength(0);
  });

  it("outranks routine prepared outbound — the inbound request is picked first, never buried", async () => {
    // A routine prepared outbound Review (priority 40) …
    const routine = await insertLead({ ...(() => { const { id, createdAt, updatedAt, ...r } = makeLead({ businessName: "Routine Dental", publicEmail: "hi@routinedental.com" }); return r; })() });
    const { insertTask } = await import("@/lib/repo");
    await insertTask({ leadId: routine.id, type: "review_and_send", title: "Send review", dueAt: new Date().toISOString(), status: "open", priority: 40, snoozedUntil: null });
    // … and an inbound Content #001 request (priority 80).
    await requestReviewAction({ businessName: "Inbound Co", website: "inboundco.com", email: "owner@inboundco.com", ref: "content-001" });
    const inbound = (await inboundLead())!;

    const leadMap = new Map((await listLeads()).map((l) => [l.id, l] as const));
    const tasks = (await allTasks()).filter((t) => t.status === "open").sort((a, b) => b.priority - a.priority); // as todaysTasks surfaces
    // Email stream capacity of exactly 1 → whichever the system deems most important surfaces.
    const capacity = channelCapacity({ callTarget: 10, emailTarget: 10, videoTarget: 3, otherBudget: 8, emailsSentToday: 9 });
    expect(capacity.email).toBe(1);
    const surfaced = surfaceTodaysTasks({ tasks, leads: leadMap, capacity });
    const surfacedLeadIds = surfaced.map((t) => t.leadId);
    expect(surfacedLeadIds).toContain(inbound.id);   // the requester is surfaced …
    expect(surfacedLeadIds).not.toContain(routine.id); // … ahead of routine outbound

    // Both remain in the prepared reservoir (nothing lost).
    const inv = emailInventory({ leads: leadMap, tasks: await allTasks(), emailsSentToday: 9, sendTarget: 10 });
    expect(inv.prepared).toBe(2);
    expect(inv.readyToday).toBe(1);
    expect(inv.beyondToday).toBe(1);
  });
});

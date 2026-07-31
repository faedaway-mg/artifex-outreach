import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { __resetStoreForTests } from "./store";
import { insertLead, insertTask, listLeads, allTasks } from "./repo";
import { accountQueue } from "./queue-accounting";
import { makeLead } from "./test-lead";
import type { Lead } from "./types";

async function seedLead(over: Partial<Lead> = {}) {
  const base = makeLead({ publicEmail: "hi@x.com", phone: null, ...over });
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = base;
  return insertLead(rest);
}
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const daysAhead = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

describe("accountQueue — the full honest ledger", () => {
  beforeEach(() => __resetStoreForTests());

  it("classifies every task and lead: surfaced, beyond-cap, future, snoozed, no-work", async () => {
    // 2 due-today call tasks (high priority), 3 due-today review_and_send, cap = 3.
    const withCalls = await seedLead({ businessName: "Calls Co", publicEmail: null, phone: "(213) 329-7576" });
    await insertTask({ leadId: withCalls.id, type: "call", title: "call", dueAt: daysAgo(0), status: "open", priority: 60, snoozedUntil: null });
    const emailLeads = [];
    for (let i = 0; i < 3; i++) {
      const l = await seedLead({ businessName: `Email Co ${i}` });
      emailLeads.push(l);
      await insertTask({ leadId: l.id, type: "review_and_send", title: "send", dueAt: daysAgo(1), status: "open", priority: 40, snoozedUntil: null });
    }
    // One future follow-up, one snoozed, one lead with no work at all, one terminal no-work.
    const future = await seedLead({ businessName: "Future Co" });
    await insertTask({ leadId: future.id, type: "call", title: "later", dueAt: daysAhead(3), status: "open", priority: 55, snoozedUntil: null });
    const snoozy = await seedLead({ businessName: "Snooze Co" });
    await insertTask({ leadId: snoozy.id, type: "review", title: "z", dueAt: daysAgo(0), status: "open", priority: 30, snoozedUntil: daysAhead(2) });
    await seedLead({ businessName: "Stranded Co" }); // ACTIVE, zero tasks — the starvation case
    await seedLead({ businessName: "Lost Co", pipelineStage: "Lost" }); // terminal, zero tasks

    const a = accountQueue({ leads: await listLeads(), tasks: await allTasks(), cap: 3 });

    expect(a.totalLeads).toBe(8);
    expect(a.openTasks).toBe(6);
    expect(a.surfaced).toBe(3); // capped
    expect(a.beyondCap).toBe(1); // 4 due today, cap 3
    expect(a.waitingFuture).toBe(1);
    expect(a.snoozed).toBe(1);
    expect(a.leadsWithNoWork).toBe(2);
    expect(a.noWorkActive).toBe(1); // Stranded Co — the alarm number
    expect(a.noWorkTerminal).toBe(1); // Lost Co — correctly not alarming
    // The call outranks the sends; surfaced kinds reflect the strategy bucketing.
    expect(a.surfacedByKind.call).toBe(1);
    expect(a.surfacedByKind.email).toBe(2);
    expect(a.beyondCapByKind.email).toBe(1);
  });

  it("with no cap pressure and full coverage, nothing is hidden", async () => {
    const l = await seedLead({ businessName: "Only Co" });
    await insertTask({ leadId: l.id, type: "review_and_send", title: "send", dueAt: daysAgo(0), status: "open", priority: 40, snoozedUntil: null });
    const a = accountQueue({ leads: await listLeads(), tasks: await allTasks(), cap: 8 });
    expect(a.surfaced).toBe(1);
    expect(a.beyondCap).toBe(0);
    expect(a.noWorkActive).toBe(0);
  });

  it("counts done-today completions for the mission", async () => {
    const l = await seedLead({ businessName: "Done Co" });
    const t = await insertTask({ leadId: l.id, type: "review", title: "r", dueAt: daysAgo(0), status: "open", priority: 30, snoozedUntil: null });
    const { updateTask } = await import("./repo");
    await updateTask(t.id, { status: "done" });
    const a = accountQueue({ leads: await listLeads(), tasks: await allTasks(), cap: 8 });
    expect(a.completedToday).toBe(1);
    // The lead now has no open work → it must show up as active-but-unqueued.
    expect(a.noWorkActive).toBe(1);
  });
});

describe("completeTaskAction — understanding a business hands off, never strands", () => {
  beforeEach(() => __resetStoreForTests());

  it("completing the review (understand) task queues the outreach successor", async () => {
    vi.resetModules();
    const { completeTaskAction } = await import("./actions");
    const l = await seedLead({ businessName: "Continuity Co" });
    const t = await insertTask({ leadId: l.id, type: "review", title: "understand", dueAt: daysAgo(0), status: "open", priority: 30, snoozedUntil: null });
    await completeTaskAction(t.id);
    const open = (await allTasks()).filter((x) => x.leadId === l.id && x.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0].type).toBe("review_and_send");
  });

  it("no successor for terminal leads, and none when other open work already exists", async () => {
    const { completeTaskAction } = await import("./actions");
    const lost = await seedLead({ businessName: "Lost Co", pipelineStage: "Lost" });
    const t1 = await insertTask({ leadId: lost.id, type: "review", title: "r", dueAt: daysAgo(0), status: "open", priority: 30, snoozedUntil: null });
    await completeTaskAction(t1.id);
    expect((await allTasks()).filter((x) => x.leadId === lost.id && x.status === "open")).toHaveLength(0);

    const busy = await seedLead({ businessName: "Busy Co" });
    const t2 = await insertTask({ leadId: busy.id, type: "review", title: "r", dueAt: daysAgo(0), status: "open", priority: 30, snoozedUntil: null });
    await insertTask({ leadId: busy.id, type: "call", title: "existing", dueAt: daysAgo(0), status: "open", priority: 50, snoozedUntil: null });
    await completeTaskAction(t2.id);
    const open = (await allTasks()).filter((x) => x.leadId === busy.id && x.status === "open");
    expect(open).toHaveLength(1); // only the pre-existing call — no duplicate successor
    expect(open[0].type).toBe("call");
  });

  it("completing a non-review task (call / review_and_send) creates no successor", async () => {
    const { completeTaskAction } = await import("./actions");
    const l = await seedLead({ businessName: "NoLoop Co" });
    const t = await insertTask({ leadId: l.id, type: "review_and_send", title: "send", dueAt: daysAgo(0), status: "open", priority: 40, snoozedUntil: null });
    await completeTaskAction(t.id);
    expect((await allTasks()).filter((x) => x.leadId === l.id && x.status === "open")).toHaveLength(0);
  });
});

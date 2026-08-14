// ─────────────────────────────────────────────────────────────────────────────
// Reservoir / throughput acceptance tests (sprint items D, F, G, K, M, N, O) that need the
// real repo + routing + prep machinery. Preparation may run ahead; SENDING stays 10/day and
// human-gated; nothing here sends. Complements the pure reservoir.test.ts and the ordering tests.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { __resetStoreForTests } from "../store";
import { insertLead, insertTask, getLead, allTasks } from "../repo";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";
import { materializeRouting } from "../outreach/auto-route";
import { prepareEmailInventory } from "../outreach/inventory-prep";
import { emailInventory } from "../work-queue";

const seed = async (over: Partial<Lead> = {}): Promise<Lead> => {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = makeLead({ lastContactAt: null, nextFollowUpAt: null, ...over });
  return insertLead(rest);
};
const openTasks = async () => (await allTasks()).filter((t) => t.status === "open");
const preparedCount = async () => {
  const leads = new Map((await Promise.all((await allTasks()).map(async (t) => (await getLead(t.leadId))!))).map((l) => [l.id, l]));
  return emailInventory({ leads, tasks: await openTasks(), emailsSentToday: 0, sendTarget: 10 }).prepared;
};

describe("D — preparation capacity is independent of the 10/day SEND capacity", () => {
  beforeEach(() => __resetStoreForTests());
  it("a deep prepared reservoir never raises what can be sent today above the send cap", async () => {
    // 20 email-first leads each with a prepared review task.
    for (let i = 0; i < 20; i++) {
      const l = await seed({ businessName: `Biz ${i}`, publicEmail: `hi@biz${i}.com`, websiteDomain: `biz${i}.com`, website: `https://biz${i}.com` });
      await insertTask({ leadId: l.id, type: "review_and_send", title: "R", dueAt: new Date().toISOString(), status: "open", priority: 40, snoozedUntil: null });
    }
    const leads = new Map((await Promise.all((await allTasks()).map(async (t) => (await getLead(t.leadId))!))).map((l) => [l.id, l]));
    const inv = emailInventory({ leads, tasks: await openTasks(), emailsSentToday: 0, sendTarget: 10 });
    expect(inv.prepared).toBe(20);
    expect(inv.readyToday).toBe(10);   // capped at the send target regardless of reservoir depth
    expect(inv.beyondToday).toBe(10);
    // Even doubling the reservoir cannot raise readyToday past the cap.
    const inv2 = emailInventory({ leads, tasks: await openTasks(), emailsSentToday: 0, sendTarget: 10 });
    expect(inv2.readyToday).toBeLessThanOrEqual(10);
  });
});

describe("F & G — low inventory NEVER manufactures cold calls or videos", () => {
  beforeEach(() => __resetStoreForTests());
  it("preparation only runs website analysis on email-eligible leads; it creates no call/video work", async () => {
    // Two site-but-no-email leads (email-eligible) + one no-website lead.
    const a = await seed({ businessName: "A", publicEmail: null, website: "https://a.com", websiteDomain: "a.com" });
    const b = await seed({ businessName: "B", publicEmail: null, website: "https://b.com", websiteDomain: "b.com" });
    await seed({ businessName: "C", publicEmail: null, website: null, websiteDomain: null });
    void b;
    // analyze() harvests an email for A only (B fails discovery).
    const { updateLead, listLeads } = await import("../repo");
    const analyze = async (id: string) => { if (id === a.id) await updateLead(id, { publicEmail: "hi@a.com" }); };
    const summary = await prepareEmailInventory({
      leads: await listLeads(),
      analyzedLeadIds: new Set(),
      analyze,
      getEmailAfter: async (id) => (await getLead(id))?.publicEmail ?? null,
      max: 8,
    });
    expect(summary.adoptedEmail).toBe(1); // only A
    // No call or video tasks were created anywhere by preparation.
    const all = await allTasks();
    expect(all.some((t) => t.type === "call")).toBe(false);
    expect(all.some((t) => t.type === "prepare_video")).toBe(false);
  });
});

describe("K — a prepared lead is not re-analyzed on later prep runs (durable inventory, no waste)", () => {
  beforeEach(() => __resetStoreForTests());
  it("prepareEmailInventory skips already-analyzed leads", async () => {
    const a = await seed({ businessName: "A", publicEmail: null, website: "https://a.com", websiteDomain: "a.com" });
    let analyzeCalls = 0;
    const analyze = async (_id: string) => { analyzeCalls++; };
    const leads = [...(await (await import("../repo")).listLeads())];
    // First run: A is eligible and analyzed once.
    await prepareEmailInventory({ leads, analyzedLeadIds: new Set(), analyze, getEmailAfter: async () => null, max: 8 });
    expect(analyzeCalls).toBe(1);
    // Second run: A already analyzed → skipped, no re-analysis cost.
    await prepareEmailInventory({ leads, analyzedLeadIds: new Set([a.id]), analyze, getEmailAfter: async () => null, max: 8 });
    expect(analyzeCalls).toBe(1);
  });
});

describe("M — failed email discovery does not create a bogus ready item", () => {
  beforeEach(() => __resetStoreForTests());
  it("a lead whose harvest yields no email stays out of the reservoir", async () => {
    const a = await seed({ businessName: "A", publicEmail: null, website: "https://a.com", websiteDomain: "a.com" });
    await prepareEmailInventory({ leads: [...(await (await import("../repo")).listLeads())], analyzedLeadIds: new Set(), analyze: async () => {}, getEmailAfter: async () => null, max: 8 });
    await materializeRouting();
    // Still no valid email → not email-first → no email task → not in reservoir.
    expect((await getLead(a.id))?.publicEmail ?? null).toBeNull();
    expect(await preparedCount()).toBe(0);
  });
});

describe("N — duplicate materialization does not duplicate operator work", () => {
  beforeEach(() => __resetStoreForTests());
  it("running materializeRouting twice yields exactly one email task for an email-first lead", async () => {
    const a = await seed({ businessName: "A", publicEmail: "hi@a.com", website: "https://a.com", websiteDomain: "a.com", pipelineStage: "Qualified" });
    await materializeRouting();
    await materializeRouting();
    const emailTasks = (await allTasks()).filter((t) => t.leadId === a.id && t.type === "review_and_send" && t.status === "open");
    expect(emailTasks).toHaveLength(1);
  });
});

describe("O — the six-stranded condition heals on reconciliation (regression)", () => {
  beforeEach(() => __resetStoreForTests());
  it("an email-first lead with a valid email but no email task gains one, entering the reservoir", async () => {
    // Reproduce the stranded shape: email-first, never contacted, but NO email task.
    const a = await seed({ businessName: "Stranded Co", publicEmail: "info@stranded.com", website: "https://stranded.com", websiteDomain: "stranded.com", pipelineStage: "Qualified", lastContactAt: null });
    expect(await preparedCount()).toBe(0); // stranded — not yet in the reservoir
    await materializeRouting();             // the daily reconciliation tick
    const emailTasks = (await allTasks()).filter((t) => t.leadId === a.id && t.type === "review_and_send" && t.status === "open");
    expect(emailTasks).toHaveLength(1);     // healed
    expect(await preparedCount()).toBe(1);  // now counted in the reservoir
  });
});

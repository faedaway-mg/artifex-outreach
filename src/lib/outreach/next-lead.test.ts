import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, insertTask, updateLead, getLead, allTasks } from "../repo";
import { resolveNextLead } from "./next-lead";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

// A call-first lead with an open "call" task due today → lands in the call batch.
async function seedCallLead(name: string, priority: number, over: Partial<Lead> = {}) {
  const base = makeLead({ businessName: name, phone: "(213) 555-0100", publicEmail: null, website: null, socialLinks: [], note: null, lastContactAt: null, ...over });
  const { id, createdAt, updatedAt, ...rest } = base;
  const lead = await insertLead(rest);
  await insertTask({ leadId: lead.id, type: "call", title: `Call — ${name}`, dueAt: new Date().toISOString(), status: "open", priority, snoozedUntil: null });
  return lead;
}

describe("resolveNextLead — restore the operator loop", () => {
  beforeEach(() => __resetStoreForTests());

  it("returns the next actionable business, not the current one", async () => {
    const a = await seedCallLead("A", 30);
    const b = await seedCallLead("B", 20);
    await seedCallLead("C", 10);
    const res = await resolveNextLead(a.id);
    expect(res.done).toBe(false);
    expect(res.nextLeadId).toBe(b.id); // highest-priority remaining, never A
  });

  it("skips a lead already contacted today", async () => {
    const a = await seedCallLead("A", 30);
    const b = await seedCallLead("B", 20);
    const c = await seedCallLead("C", 10);
    await updateLead(b.id, { lastContactAt: new Date().toISOString() }); // B was handled today
    const res = await resolveNextLead(a.id);
    expect(res.nextLeadId).toBe(c.id); // B skipped
  });

  it("skips closed / invalid leads", async () => {
    const a = await seedCallLead("A", 30);
    const b = await seedCallLead("B", 20);
    const c = await seedCallLead("C", 10);
    await updateLead(b.id, { pipelineStage: "Lost" });
    await updateLead(c.id, { businessStatus: "CLOSED_PERMANENTLY" });
    const res = await resolveNextLead(a.id);
    expect(res.done).toBe(true); // only A left, which is the current lead
    expect(res.nextLeadId).toBeNull();
  });

  it("returns done when the current lead is the last actionable one", async () => {
    const a = await seedCallLead("A", 30);
    const b = await seedCallLead("B", 20);
    await updateLead(b.id, { lastContactAt: new Date().toISOString() });
    const res = await resolveNextLead(a.id);
    expect(res).toEqual({ nextLeadId: null, done: true });
  });

  it("a carried batch advances forward only (never back to an earlier lead)", async () => {
    const a = await seedCallLead("A", 30);
    const b = await seedCallLead("B", 20);
    const c = await seedCallLead("C", 10);
    const ids = [a.id, b.id, c.id];
    expect((await resolveNextLead(b.id, { ids, kind: "call" })).nextLeadId).toBe(c.id); // forward
    expect((await resolveNextLead(c.id, { ids, kind: "call" })).done).toBe(true); // nothing after C
  });

  it("is READ-ONLY — resolving the next lead never records an outcome or task", async () => {
    const a = await seedCallLead("A", 30);
    await seedCallLead("B", 20);
    const tasksBefore = (await allTasks()).length;
    const noteBefore = (await getLead(a.id))?.note ?? null;
    await resolveNextLead(a.id);
    await resolveNextLead(a.id); // double-invoke (double-click) — still no writes
    expect((await allTasks()).length).toBe(tasksBefore);
    expect((await getLead(a.id))?.note ?? null).toBe(noteBefore);
  });

  it("no other actionable lead → done (direct-entry lead with an empty board)", async () => {
    const a = await seedCallLead("A", 30);
    const res = await resolveNextLead(a.id);
    expect(res.done).toBe(true);
    expect(res.nextLeadId).toBeNull();
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { __resetStoreForTests } from "../store";
import { insertLead, insertTask, updateLead, getLead, allTasks } from "../repo";
import { resolveNextLead } from "./next-lead";
import { callWithheld } from "../work-queue";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";

// An ENGAGED call lead (booked) with an open "call" task due today → lands in the call batch. Under
// the email-first policy the queue surfaces a call only after engagement, so booked is what qualifies.
// CATEGORY: a NON-professional-office business (e.g. a restaurant), deliberately. The weekend policy
// (predictablyClosedForWeekend) correctly WITHHOLDS an engaged call to a professional office (dentist,
// law, etc.) on Sat/Sun — so a dental fixture makes these ORDERING tests fail whenever the suite runs on
// a weekend (a real-date dependence, not a resolver bug). A restaurant is engaged AND callable any day,
// so these tests deterministically exercise ordering/skip regardless of the day. The weekend routing
// itself is asserted separately below with a frozen clock. See resolveNextLead + call-priority.
async function seedCallLead(name: string, priority: number, over: Partial<Lead> = {}) {
  const base = makeLead({ businessName: name, phone: "(213) 555-0100", publicEmail: null, website: null, socialLinks: [], note: null, lastContactAt: null, pipelineStage: "Meeting Booked", industry: "Restaurant", normalizedCategory: "Restaurant", ...over });
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

// Regression: the exact routing rule the ordering tests above depend on, pinned with a FROZEN clock so
// it's deterministic every day. This is the intended "Meeting Booked + open call task" behavior —
// engaged calls surface, but a professional office is withheld on the weekend (email-first + door policy).
describe("call routing for a Meeting Booked lead (frozen clock — America/Los_Angeles)", () => {
  const SATURDAY = new Date("2026-08-29T18:00:00Z"); // Sat 11:00 PT
  const MONDAY = new Date("2026-08-31T18:00:00Z"); // Mon 11:00 PT
  const booked = (over: Partial<Lead> = {}) => makeLead({ businessName: "X", phone: "(213) 555-0100", pipelineStage: "Meeting Booked", ...over }) as Lead;

  it("engaged non-office (restaurant) call surfaces on BOTH weekday and weekend", () => {
    const r = booked({ industry: "Restaurant", normalizedCategory: "Restaurant" });
    expect(callWithheld(r, MONDAY)).toBe(false);
    expect(callWithheld(r, SATURDAY)).toBe(false);
  });

  it("engaged professional office (dental) call surfaces on a weekday but is WITHHELD on the weekend", () => {
    const office = booked({ industry: "Dental practice", normalizedCategory: "Dental practice" });
    expect(callWithheld(office, MONDAY)).toBe(false); // weekday → surfaces
    expect(callWithheld(office, SATURDAY)).toBe(true); // weekend office → withheld (intended)
  });

  it("a NON-engaged (cold) lead is never auto-surfaced for a call — email-first policy", () => {
    const cold = booked({ pipelineStage: "Discovered", industry: "Restaurant", normalizedCategory: "Restaurant" });
    expect(callWithheld(cold, MONDAY)).toBe(true);
    expect(callWithheld(cold, SATURDAY)).toBe(true);
  });
});

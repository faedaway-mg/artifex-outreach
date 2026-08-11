import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { __resetStoreForTests } from "../store";
import { insertLead, insertTask, getLead, allTasks } from "../repo";
import { makeLead } from "../test-lead";
import type { Lead } from "../types";
import { determineContactStrategy } from "./contact-strategy";
import { materializeLeadRoute, materializeRouting, findStrandedEmailLeads, routeDestinationFor } from "./auto-route";
import { buildWorkQueue } from "../work-queue";

// The real Wilshire shape: a QUALIFIED law firm (gatekeeper-heavy) with a valid info@ email,
// never contacted — the exact tracer lead that was stranded.
const wilshire = (over: Partial<Lead> = {}) =>
  makeLead({
    businessName: "Wilshire Law Firm", industry: "Law firm", normalizedCategory: "law-firm",
    publicEmail: "info@wilshirelawfirm.com", phone: "(213) 555-0100", website: "https://wilshirelawfirm.com",
    websiteDomain: "wilshirelawfirm.com", pipelineStage: "Qualified", lastContactAt: null, nextFollowUpAt: null, ...over,
  });

async function seed(over: Partial<Lead> = {}): Promise<Lead> {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = wilshire(over);
  return insertLead(rest);
}
const open = async (leadId: string) => (await allTasks()).filter((t) => t.leadId === leadId && t.status === "open");
const openOf = async (leadId: string, type: string) => (await open(leadId)).filter((t) => t.type === type);
async function emailQueueHas(leadId: string): Promise<boolean> {
  const lead = (await getLead(leadId))!;
  const tasks = (await allTasks()).filter((t) => t.status === "open");
  const q = buildWorkQueue({ tasks, meetingsToday: [], leads: new Map([[leadId, lead]]) });
  return (q.find((c) => c.kind === "email")?.leadIds ?? []).includes(leadId);
}

describe("Wilshire acceptance — a stranded email-first law firm reaches Emails to send", () => {
  beforeEach(() => __resetStoreForTests());

  it("strategy is email-first for the real shape", async () => {
    const l = await seed();
    expect(determineContactStrategy((await getLead(l.id))!).kind).toBe("email-first");
    expect(routeDestinationFor((await getLead(l.id))!)).toBe("email");
  });

  it("a stale legacy CALL task no longer strands it: reconcile supersedes the call, creates email work, and it appears in Emails to send", async () => {
    const l = await seed();
    // Legacy state from before the gatekeeper/email routing: an open cold call task.
    await insertTask({ leadId: l.id, type: "call", title: "Call — Wilshire", dueAt: new Date().toISOString(), status: "open", priority: 55, snoozedUntil: null });
    // Pre-fix invariant check: it IS stranded (email-first, no email work).
    expect(findStrandedEmailLeads({ leads: [(await getLead(l.id))!], tasks: await allTasks() })).toHaveLength(1);

    const res = await materializeLeadRoute(l.id);
    expect(res?.destination).toBe("email");
    expect(res?.created).toBe(true);
    expect(res?.superseded).toBe(1); // the stale call task retired (marked done, not deleted)

    expect(await openOf(l.id, "review_and_send")).toHaveLength(1);
    expect(await openOf(l.id, "call")).toHaveLength(0); // no first-touch call remains
    expect(await emailQueueHas(l.id)).toBe(true); // ACTUALLY on the email board
    // The invariant now holds: not stranded.
    expect(findStrandedEmailLeads({ leads: [(await getLead(l.id))!], tasks: await allTasks() })).toHaveLength(0);
  });

  it("reuses an already-correct email task — no duplicate", async () => {
    const l = await seed();
    await insertTask({ leadId: l.id, type: "review_and_send", title: "Send review", dueAt: new Date().toISOString(), status: "open", priority: 40, snoozedUntil: null });
    const res = await materializeLeadRoute(l.id);
    expect(res?.created).toBe(false);
    expect(await openOf(l.id, "review_and_send")).toHaveLength(1); // still exactly one
  });

  it("preserves a COMPLETED historical call and still creates the email task", async () => {
    const l = await seed();
    await insertTask({ leadId: l.id, type: "call", title: "Call — Wilshire", dueAt: new Date().toISOString(), status: "done", priority: 55, snoozedUntil: null });
    const res = await materializeLeadRoute(l.id);
    expect(res?.created).toBe(true);
    expect(res?.superseded).toBe(0); // the done call is history — untouched
    expect((await allTasks()).filter((t) => t.leadId === l.id && t.type === "call" && t.status === "done")).toHaveLength(1);
    expect(await openOf(l.id, "review_and_send")).toHaveLength(1);
  });

  it("does NOT create a duplicate first-touch if the intro email was already sent", async () => {
    const l = await seed();
    const res = await materializeLeadRoute(l.id, { introSent: true });
    expect(res?.created).toBe(false); // outreach already happened
    expect(await openOf(l.id, "review_and_send")).toHaveLength(0);
  });

  it("does NOT touch a call-back after real contact (outreach in progress)", async () => {
    const l = await seed({ lastContactAt: "2026-08-01T00:00:00Z" });
    await insertTask({ leadId: l.id, type: "call", title: "Follow up call", dueAt: "2026-08-20T00:00:00Z", status: "open", priority: 58, snoozedUntil: null });
    const res = await materializeLeadRoute(l.id);
    expect(res?.created).toBe(false);
    expect(res?.superseded).toBe(0);
    expect(await openOf(l.id, "call")).toHaveLength(1); // legitimate call-back preserved
  });

  it("a Do Not Contact law firm gets no outreach work", async () => {
    const l = await seed({ acquisitionStrategy: "Do Not Contact" });
    const res = await materializeLeadRoute(l.id);
    expect(res?.destination).toBe("none");
    expect(await openOf(l.id, "review_and_send")).toHaveLength(0);
  });

  it("a terminal (Disqualified) law firm gets no outreach work", async () => {
    const l = await seed({ pipelineStage: "Disqualified" });
    const res = await materializeLeadRoute(l.id);
    expect(res?.destination).toBe("none");
    expect(await openOf(l.id, "review_and_send")).toHaveLength(0);
  });
});

describe("findStrandedEmailLeads — the no-silent-stranding invariant", () => {
  beforeEach(() => __resetStoreForTests());

  it("flags email-first leads with no email work, ignoring contacted / sent / in-sequence ones", async () => {
    const stranded = await seed({ businessName: "Stranded LLP" });
    const contacted = await seed({ businessName: "Contacted LLP", lastContactAt: "2026-08-01T00:00:00Z" });
    const withWork = await seed({ businessName: "Queued LLP" });
    await insertTask({ leadId: withWork.id, type: "review_and_send", title: "x", dueAt: new Date().toISOString(), status: "open", priority: 40, snoozedUntil: null });

    const leads = [await getLead(stranded.id), await getLead(contacted.id), await getLead(withWork.id)].filter(Boolean) as Lead[];
    const flagged = findStrandedEmailLeads({ leads, tasks: await allTasks() });
    expect(flagged.map((l) => l.businessName)).toEqual(["Stranded LLP"]);
  });

  it("materializeRouting reconciles the whole pool so nothing stays stranded", async () => {
    const l = await seed();
    await insertTask({ leadId: l.id, type: "call", title: "Call", dueAt: new Date().toISOString(), status: "open", priority: 55, snoozedUntil: null });
    await materializeRouting();
    expect(findStrandedEmailLeads({ leads: [(await getLead(l.id))!], tasks: await allTasks() })).toHaveLength(0);
    expect(await emailQueueHas(l.id)).toBe(true);
  });
});

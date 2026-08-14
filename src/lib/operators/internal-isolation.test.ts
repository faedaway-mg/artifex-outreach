// ─────────────────────────────────────────────────────────────────────────────
// Internal/test data isolation — the boundary between REAL operating experience and internal test
// records. Test rows remain stored + auditable, but are operationally invisible: they never enter an
// operator queue and never contaminate real business-performance metrics or the real send capacity.
// One canonical classifier: isInternalLead. Send cap 10/day and P0 chain-of-custody are untouched.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { Lead, Task, TaskType, EmailSend } from "../types";
import { isInternalLead } from "./assignment";
import { leadIdsInScope } from "./scope";
import { emailsSentOn } from "../outreach/send-capacity";
import { buildWorkQueue, buildReplyCard, emailInventory, type InboundLike } from "../work-queue";
import { marketExperiment } from "../geo-market";

const realLead = (id: string, over: Partial<Lead> = {}): Lead =>
  ({ id, businessName: `Biz ${id}`, source: "Google Places", industry: "Dental practice", city: "Columbus", state: "OH", publicEmail: `hi@${id}.com`, assignedTo: null, pipelineStage: "Qualified", ...over } as unknown as Lead);
const testLead = (id: string, over: Partial<Lead> = {}): Lead =>
  ({ ...realLead(id, over), source: "internal-test", industry: "Internal test", publicEmail: "jordan@example.com" } as unknown as Lead);
const task = (leadId: string, type: TaskType): Task =>
  ({ id: `t_${leadId}_${type}`, leadId, type, title: "", dueAt: "2026-08-14T00:00:00Z", status: "open", priority: 40, snoozedUntil: null, createdAt: "", updatedAt: "" } as Task);
const send = (leadId: string, sentAt: string | null): EmailSend => ({ id: `s_${leadId}`, leadId, sentAt } as unknown as EmailSend);
const scopeAll = (leads: Lead[]) =>
  leadIdsInScope({ scope: { kind: "all" } as any, viewerId: "op1", leads, operators: [], ctx: { plans: [], meetings: [] } as any, now: new Date("2026-08-14T12:00:00Z") });

describe("canonical classification", () => {
  it("identifies internal by source/industry, NOT by a name containing 'test'", () => {
    expect(isInternalLead(testLead("a"))).toBe(true);
    expect(isInternalLead(realLead("b", { businessName: "Test Kitchen Bakery" }))).toBe(false); // a real prospect
    expect(isInternalLead(realLead("c"))).toBe(false);
  });
});

describe("operational scope excludes internal leads (Today / /work / next-lead all derive from this)", () => {
  it("internal leads are never in scope, in any scope kind", () => {
    const leads = [realLead("r1"), testLead("t1")];
    expect([...scopeAll(leads)]).toEqual(["r1"]);
    for (const kind of ["mine", "team", "unassigned", "all"] as const) {
      const ids = leadIdsInScope({ scope: { kind } as any, viewerId: "op1", leads, operators: [], ctx: { plans: [], meetings: [] } as any, now: new Date() });
      expect(ids.has("t1")).toBe(false);
    }
  });
});

describe("E — a test send never consumes one of the 10 real daily slots", () => {
  it("emailsSentOn excludes internal-lead sends", () => {
    const now = new Date("2026-08-14T12:00:00Z");
    const today = "2026-08-14T09:00:00Z";
    const sends = [send("r1", today), send("t1", today), send("t2", today)];
    const internal = new Set(["t1", "t2"]);
    expect(emailsSentOn(sends, now)).toBe(3);                                   // raw
    expect(emailsSentOn(sends, now, { excludeLeadIds: internal })).toBe(1);     // real only → 9 slots remain
  });
});

describe("F — internal outcomes don't affect the market/receptivity experiment", () => {
  it("marketExperiment over real-only leads ignores internal activity", () => {
    const real = [realLead("r1", { city: "Columbus", state: "OH" })];
    const withInternalFiltered = [real[0]]; // callers pass real-only (post isInternalLead filter)
    const out = marketExperiment({ leads: withInternalFiltered, sentLeadIds: new Set(["r1", "t1"]), repliedLeadIds: new Set(["t1"]), metLeadIds: new Set() });
    const totalEmailed = out.primary.emailed + out.secondary.emailed + out.regional.emailed;
    const totalReplies = out.primary.replies + out.secondary.replies + out.regional.replies;
    expect(totalEmailed).toBe(1);  // only r1 counted; t1 (internal) absent from leads
    expect(totalReplies).toBe(0);  // the internal "reply" never lands
  });
});

describe("MIXED MORNING — 10 real + 3 test emails, 2 real + 4 test follow-ups, 1 real + 2 test replies", () => {
  it("the operational board shows Emails=10, Follow-ups=2, Replies=1 — no test work", () => {
    const leads: Lead[] = [];
    const tasks: Task[] = [];
    const inbound: InboundLike[] = [];
    // 10 real email prospects (review_and_send → email) + 3 internal
    for (let i = 0; i < 10; i++) { const l = realLead(`re${i}`); leads.push(l); tasks.push(task(l.id, "review_and_send")); }
    for (let i = 0; i < 3; i++) { const l = testLead(`te${i}`); leads.push(l); tasks.push(task(l.id, "review_and_send")); }
    // 2 real follow-ups + 4 internal
    for (let i = 0; i < 2; i++) { const l = realLead(`rf${i}`, { publicEmail: `f${i}@x.com` }); leads.push(l); tasks.push(task(l.id, "follow_up")); }
    for (let i = 0; i < 4; i++) { const l = testLead(`tf${i}`); leads.push(l); tasks.push(task(l.id, "follow_up")); }
    // 1 real reply + 2 internal replies
    { const l = realLead("rr0"); leads.push(l); inbound.push({ leadId: l.id, classification: "Interested", reviewedAt: null }); }
    for (let i = 0; i < 2; i++) { const l = testLead(`tr${i}`); leads.push(l); inbound.push({ leadId: l.id, classification: "Interested", reviewedAt: null }); }

    // Operational lead set = scope (excludes internal). Everything downstream reads from it.
    const scoped = scopeAll(leads);
    const leadMap = new Map(leads.filter((l) => scoped.has(l.id)).map((l) => [l.id, l]));
    const realTasks = tasks.filter((t) => scoped.has(t.leadId));

    const cats = buildWorkQueue({ tasks: realTasks, meetingsToday: [], leads: leadMap });
    expect(cats.find((c) => c.kind === "email")?.count ?? 0).toBe(10);
    expect(cats.find((c) => c.kind === "follow-up")?.count ?? 0).toBe(2);

    const reply = buildReplyCard({ inbound: inbound.filter((m) => scoped.has(m.leadId)), leads: leadMap });
    expect(reply?.count ?? 0).toBe(1);

    // J — reservoir/supply reads real prospects only.
    const inv = emailInventory({ leads: leadMap, tasks: realTasks, emailsSentToday: 0, sendTarget: 10 });
    expect(inv.prepared).toBe(10);

    // H — the test records still EXIST (stored/auditable), just not operational.
    expect(leads.filter(isInternalLead).length).toBe(9);
  });
});

describe("G — real prospects continue to work normally", () => {
  it("a real email prospect surfaces on the board and in the reservoir", () => {
    const l = realLead("r1");
    const scoped = scopeAll([l]);
    const leadMap = new Map([[l.id, l]]);
    const cats = buildWorkQueue({ tasks: [task(l.id, "review_and_send")], meetingsToday: [], leads: leadMap });
    expect(scoped.has("r1")).toBe(true);
    expect(cats.find((c) => c.kind === "email")?.count).toBe(1);
  });
});

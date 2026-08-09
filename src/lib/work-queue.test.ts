import { describe, it, expect } from "vitest";
import type { Task, TaskType, Lead } from "./types";
import { buildWorkQueue, batchLeadIds, minutesLabel, buildDailyMission, surfaceTodaysTasks, channelCapacity, channelOf } from "./work-queue";

// Email-first leads (they carry an email) so a review_and_send task buckets to "email".
const lead = (id: string): Lead => ({ id, businessName: `Biz ${id}`, publicEmail: `hi@biz-${id}.com`, phone: null, socialLinks: [], contactFormUrl: null } as unknown as Lead);
const task = (leadId: string, type: TaskType): Task => ({ id: `t_${leadId}_${type}`, leadId, type, title: "", dueAt: "2026-07-23T00:00:00Z", status: "open", priority: 1, snoozedUntil: null, createdAt: "", updatedAt: "" } as Task);
const leadsMap = (...ids: string[]) => new Map(ids.map((id) => [id, lead(id)]));

describe("work queue — organizes work into batches, urgency-first", () => {
  it("groups tasks by kind with counts, time estimates, and one CTA each", () => {
    const cats = buildWorkQueue({
      tasks: [task("A", "prepare_video"), task("B", "prepare_video"), task("C", "review_and_send")],
      meetingsToday: [],
      leads: leadsMap("A", "B", "C"),
    });
    const video = cats.find((c) => c.kind === "video")!;
    expect(video.count).toBe(2);
    expect(video.estMinutes).toBe(16); // 2 × 8
    expect(video.ctaLabel).toBe("Start video batch");
    expect(video.href).toBe("/work/video");
    const email = cats.find((c) => c.kind === "email")!;
    expect(email.count).toBe(1);
  });

  it("time-bound discovery calls sort first", () => {
    const cats = buildWorkQueue({
      tasks: [task("A", "prepare_video"), task("B", "follow_up")],
      meetingsToday: [{ leadId: "C", scheduledAt: "2026-07-23T15:00:00Z" }],
      leads: leadsMap("A", "B", "C"),
    });
    expect(cats[0].kind).toBe("discovery");
    expect(cats[0].timeBound).toBe(true);
  });

  it("dedupes a business within a batch", () => {
    const cats = buildWorkQueue({ tasks: [task("A", "prepare_video"), task("A", "prepare_video")], meetingsToday: [], leads: leadsMap("A") });
    expect(cats.find((c) => c.kind === "video")!.count).toBe(1);
  });

  it("omits empty categories and skips unknown leads", () => {
    const cats = buildWorkQueue({ tasks: [task("GHOST", "call")], meetingsToday: [], leads: leadsMap("A") });
    expect(cats).toHaveLength(0);
  });

  it("exposes an ordered batch list for the runner", () => {
    const cats = buildWorkQueue({ tasks: [task("A", "call"), task("B", "call")], meetingsToday: [], leads: leadsMap("A", "B") });
    expect(batchLeadIds(cats, "call")).toEqual(["A", "B"]);
  });

  it("formats time estimates for humans", () => {
    expect(minutesLabel(35)).toBe("35 min");
    expect(minutesLabel(90)).toBe("1h 30m");
    expect(minutesLabel(0)).toBe("");
  });

  // Business-hours awareness: a business we can PROVE is closed right now does not
  // belong on the active CALL board — but only the call channel is affected, and only
  // reliable hours withhold anyone.
  it("withholds a known-closed business from the CALL queue but never from async work", () => {
    const SUN_10AM_PT = new Date("2026-08-09T17:00:00Z"); // a Sunday
    const withHours = (id: string, hours: string | null): Lead => ({ ...lead(id), state: "CA", longitude: null, latitude: null, address: null, hours } as unknown as Lead);
    const leads = new Map<string, Lead>([
      ["CLOSED", withHours("CLOSED", "Mon–Fri 8–5")], // reliably shut on a Sunday
      ["OPEN", withHours("OPEN", "24/7")], // open right now
      ["UNKNOWN", withHours("UNKNOWN", null)], // no hours → must NOT be suppressed
    ]);
    const cats = buildWorkQueue({
      tasks: [task("CLOSED", "call"), task("OPEN", "call"), task("UNKNOWN", "call"), task("CLOSED", "follow_up")],
      meetingsToday: [],
      leads,
      now: SUN_10AM_PT,
    });
    const call = cats.find((c) => c.kind === "call");
    expect(call?.leadIds ?? []).not.toContain("CLOSED"); // withheld
    expect(call?.leadIds).toContain("OPEN"); // open now → eligible
    expect(call?.leadIds).toContain("UNKNOWN"); // unknown hours fail open → eligible
    // The closed business's asynchronous work is untouched — closure is phone-only.
    expect(cats.find((c) => c.kind === "follow-up")?.leadIds).toContain("CLOSED");
  });

  it("builds today's mission: total = remaining + done, counting businesses once", () => {
    const cats = buildWorkQueue({ tasks: [task("A", "prepare_video"), task("A", "review_and_send"), task("B", "call")], meetingsToday: [], leads: leadsMap("A", "B") });
    const mission = buildDailyMission(cats, 3);
    expect(mission.remaining).toBe(2); // A and B — a business counts once even with two tasks
    expect(mission.done).toBe(3);
    expect(mission.total).toBe(5);
    expect(mission.estMinutes).toBeGreaterThan(0);
  });
});

// Calls and emails are parallel streams. The old combined cap let calls fill the day
// and strand email-first leads; these pin the per-stream capacity that fixes it.
describe("channel-aware capacity — calls and emails as parallel streams", () => {
  const emailTasks = (n: number) => Array.from({ length: n }, (_, i) => task(`E${i}`, "review_and_send"));
  const callTasks = (n: number) => Array.from({ length: n }, (_, i) => task(`C${i}`, "call"));
  const mapFor = (tasks: Task[]) => new Map(tasks.map((t) => [t.leadId, lead(t.leadId)]));

  it("channelOf routes calls, emails+follow-ups, and everything else to their streams", () => {
    expect(channelOf("call")).toBe("call");
    expect(channelOf("email")).toBe("email");
    expect(channelOf("follow-up")).toBe("email"); // follow-ups are email sends → same warm-up budget
    expect(channelOf("report")).toBe("other");
    expect(channelOf("video")).toBe("other");
  });

  it("channelCapacity subtracts today's sends from the warm-up ceiling", () => {
    expect(channelCapacity({ callTarget: 10, emailTarget: 10, otherBudget: 8 }).email).toBe(10);
    expect(channelCapacity({ callTarget: 10, emailTarget: 10, otherBudget: 8, emailsSentToday: 4 }).email).toBe(6);
    expect(channelCapacity({ callTarget: 10, emailTarget: 10, otherBudget: 8, emailsSentToday: 99 }).email).toBe(0); // never negative
    // Sensible defaults when nothing is configured.
    expect(channelCapacity({ otherBudget: 8 })).toMatchObject({ call: 10, email: 10, other: 8 });
  });

  it("surfaces email-first leads up to email capacity — calls never crowd them out", () => {
    const all = [...callTasks(12), ...emailTasks(12)]; // 12 of each, calls first (as priority would)
    const leads = mapFor(all);
    const surfaced = surfaceTodaysTasks({ tasks: all, leads, capacity: { call: 10, email: 10, other: 8 } });
    const calls = surfaced.filter((t) => t.type === "call");
    const emails = surfaced.filter((t) => t.type === "review_and_send");
    expect(calls).toHaveLength(10); // both streams get their full capacity...
    expect(emails).toHaveLength(10); // ...even though calls sorted first
    expect(surfaced).toHaveLength(20); // ~20 businesses in a session, not 8
  });

  it("does not let a small combined target impose a hard ceiling on total outreach", () => {
    // Even with a modest per-stream target, the day holds calls + emails together.
    const all = [...emailTasks(6), ...callTasks(6)];
    const surfaced = surfaceTodaysTasks({ tasks: all, leads: mapFor(all), capacity: { call: 6, email: 6, other: 0 } });
    expect(surfaced).toHaveLength(12);
  });

  it("holds email work back when the warm-up send ceiling is spent — nothing lost", () => {
    const all = emailTasks(5);
    const leads = mapFor(all);
    const capacity = channelCapacity({ emailTarget: 10, otherBudget: 8, emailsSentToday: 10 }); // ceiling reached
    const surfaced = surfaceTodaysTasks({ tasks: all, leads, capacity });
    expect(surfaced).toHaveLength(0); // deferred, not surfaced
    // The tasks still exist for tomorrow — surfacing is read-only, it drops nothing.
    expect(all).toHaveLength(5);
  });

  it("replenishes: once a surfaced email completes, the next eligible one takes its slot", () => {
    const all = emailTasks(12);
    const leads = mapFor(all);
    const cap = { call: 10, email: 10, other: 8 };
    const first = surfaceTodaysTasks({ tasks: all, leads, capacity: cap });
    expect(first).toHaveLength(10);
    // Operator sends one → it's done → remove it → the queue recomputes.
    const remaining = all.filter((t) => t.leadId !== first[0].leadId);
    const second = surfaceTodaysTasks({ tasks: remaining, leads, capacity: cap });
    expect(second).toHaveLength(10); // an 11th lead now appears — no "no tasks" after 2 sends
    expect(second.map((t) => t.leadId)).not.toContain(first[0].leadId);
  });

  it("call and email streams coexist; working one never removes the other's tasks", () => {
    const all = [...emailTasks(3), ...callTasks(3)];
    const surfaced = surfaceTodaysTasks({ tasks: all, leads: mapFor(all), capacity: { call: 10, email: 10, other: 8 } });
    expect(surfaced.filter((t) => t.type === "call")).toHaveLength(3);
    expect(surfaced.filter((t) => t.type === "review_and_send")).toHaveLength(3);
  });

  it("a known-closed CALL lead is skipped WITHOUT spending a call slot, but its email still surfaces", () => {
    const SUN_10AM_PT = new Date("2026-08-09T17:00:00Z");
    const closedCallLead: Lead = { ...lead("CLOSED"), state: "CA", longitude: null, latitude: null, address: null, hours: "Mon–Fri 8–5" } as unknown as Lead;
    const leads = new Map<string, Lead>([["CLOSED", closedCallLead], ["C0", lead("C0")], ["C1", lead("C1")]]);
    const tasks = [task("CLOSED", "call"), task("C0", "call"), task("C1", "call"), task("CLOSED", "review_and_send")];
    const surfaced = surfaceTodaysTasks({ tasks, leads, capacity: { call: 2, email: 10, other: 8 }, now: SUN_10AM_PT });
    const callIds = surfaced.filter((t) => t.type === "call").map((t) => t.leadId);
    expect(callIds).not.toContain("CLOSED"); // withheld
    expect(callIds).toEqual(["C0", "C1"]); // the closed lead did NOT consume a call slot
    // The closed business's ASYNC email work is unaffected — closure is phone-only.
    expect(surfaced.some((t) => t.leadId === "CLOSED" && t.type === "review_and_send")).toBe(true);
  });
});

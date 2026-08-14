// ─────────────────────────────────────────────────────────────────────────────
// Board reconciliation acceptance tests — the Today board must express the ACTUAL
// operating model: email is the primary first-touch, replies come first, "Needs
// attention" is not a founder chore, and calls/videos are signal-triggered (no quota).
// Includes the sprint's two required synthetic mornings.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import type { Task, TaskType, Lead } from "./types";
import { buildWorkQueue, buildReplyCard, emailInventory, type InboundLike } from "./work-queue";

// Email-first leads (carry an email) so a review_and_send buckets to "email".
const lead = (id: string): Lead => ({ id, businessName: `Biz ${id}`, publicEmail: `hi@biz-${id}.com`, phone: null, socialLinks: [], contactFormUrl: null } as unknown as Lead);
const task = (leadId: string, type: TaskType): Task => ({ id: `t_${leadId}_${type}`, leadId, type, title: "", dueAt: "2026-07-23T00:00:00Z", status: "open", priority: 1, snoozedUntil: null, createdAt: "", updatedAt: "" } as Task);
const leadsMap = (...ids: string[]) => new Map(ids.map((id) => [id, lead(id)]));

describe("board ordering — email is the primary proactive action", () => {
  it("email sorts ABOVE follow-ups, calls, and videos", () => {
    const cats = buildWorkQueue({
      tasks: [task("V", "prepare_video"), task("F", "follow_up"), task("C", "call"), task("E", "review_and_send")],
      meetingsToday: [], leads: leadsMap("V", "F", "C", "E"),
    });
    const order = cats.map((c) => c.kind);
    expect(order.indexOf("email")).toBeLessThan(order.indexOf("follow-up"));
    expect(order.indexOf("email")).toBeLessThan(order.indexOf("call"));
    expect(order.indexOf("email")).toBeLessThan(order.indexOf("video"));
  });

  it("booked discovery conversations still sort above email (time-bound)", () => {
    const cats = buildWorkQueue({
      tasks: [task("E", "review_and_send")],
      meetingsToday: [{ leadId: "M", scheduledAt: "2026-07-23T15:00:00Z" }],
      leads: leadsMap("E", "M"),
    });
    const order = cats.map((c) => c.kind);
    expect(order.indexOf("discovery")).toBeLessThan(order.indexOf("email"));
  });
});

describe("Needs attention is not a founder chore", () => {
  it("buildWorkQueue never emits an 'understand' card, even with review tasks present", () => {
    const cats = buildWorkQueue({
      tasks: [task("A", "review"), task("B", "review"), task("E", "review_and_send")],
      meetingsToday: [], leads: leadsMap("A", "B", "E"),
    });
    expect(cats.find((c) => c.kind === "understand")).toBeUndefined();
    expect(cats.find((c) => c.kind === "email")).toBeDefined();
  });
});

describe("replies & inbound lead the board", () => {
  const inbound = (leadId: string, classification: string, reviewedAt: string | null = null): InboundLike => ({ leadId, classification, reviewedAt });

  it("builds a reply card only from unhandled HUMAN replies (not auto-replies/bounces)", () => {
    const card = buildReplyCard({
      inbound: [inbound("A", "Interested"), inbound("B", "Out Of Office"), inbound("C", "Bounce"), inbound("D", "Question", "2026-07-23T00:00:00Z")],
      leads: leadsMap("A", "B", "C", "D"),
    });
    expect(card).not.toBeNull();
    expect(card!.leadIds).toEqual(["A"]); // B/C are auto/bounce, D already handled
    expect(card!.kind).toBe("reply");
  });

  it("returns null when nothing needs a response (a healthy morning)", () => {
    expect(buildReplyCard({ inbound: [], leads: leadsMap() })).toBeNull();
    expect(buildReplyCard({ inbound: [inbound("A", "Bounce")], leads: leadsMap("A") })).toBeNull();
  });

  it("a reply outranks routine outbound email (rises above it on the board)", () => {
    const cats = buildWorkQueue({ tasks: [task("E", "review_and_send")], meetingsToday: [], leads: leadsMap("E") });
    const reply = buildReplyCard({ inbound: [inbound("R", "Interested")], leads: leadsMap("R") })!;
    cats.unshift(reply);
    // Simulate the board's final ordering by urgency.
    cats.sort((a, b) => a.urgency - b.urgency);
    expect(cats[0].kind).toBe("reply");
    expect(cats.findIndex((c) => c.kind === "reply")).toBeLessThan(cats.findIndex((c) => c.kind === "email"));
  });
});

describe("ACCEPTANCE — a normal morning: 25 prepared Reviews, capacity 10, nothing else", () => {
  it("shows 10 ready to send + 15 more prepared, and NO manufactured calls/videos/needs-attention", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `L${i}`);
    const tasks = ids.map((id) => task(id, "review_and_send"));
    const leads = leadsMap(...ids);

    const inv = emailInventory({ leads, tasks, emailsSentToday: 0, sendTarget: 10 });
    expect(inv.prepared).toBe(25);
    expect(inv.readyToday).toBe(10);      // "Emails ready to send: 10"
    expect(inv.beyondToday).toBe(15);     // "15 more Reviews prepared"

    // The board has ONLY the email batch — no calls, videos, or needs-attention were manufactured.
    const cats = buildWorkQueue({ tasks, meetingsToday: [], leads });
    expect(cats.map((c) => c.kind)).toEqual(["email"]);
    expect(cats.find((c) => c.kind === "call")).toBeUndefined();
    expect(cats.find((c) => c.kind === "video")).toBeUndefined();
    expect(cats.find((c) => c.kind === "understand")).toBeUndefined();

    // And there is nothing for the operator to respond to (0 replies) → no reply card.
    expect(buildReplyCard({ inbound: [], leads })).toBeNull();
  });
});

describe("ACCEPTANCE — a prospect replies and becomes warm: that work rises above routine email", () => {
  it("the replier's card leads the board, above the routine outbound email batch", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `L${i}`);
    const tasks = ids.map((id) => task(id, "review_and_send"));
    const leads = leadsMap(...ids, "WARM");

    const cats = buildWorkQueue({ tasks, meetingsToday: [], leads });
    const reply = buildReplyCard({ inbound: [{ leadId: "WARM", classification: "Meeting Requested", reviewedAt: null }], leads })!;
    cats.unshift(reply);
    cats.sort((a, b) => a.urgency - b.urgency);

    expect(cats[0].kind).toBe("reply");
    expect(cats[0].leadIds).toEqual(["WARM"]);
    expect(cats.findIndex((c) => c.kind === "reply")).toBeLessThan(cats.findIndex((c) => c.kind === "email"));
  });
});

import { describe, it, expect } from "vitest";
import type { Task, TaskType, Lead } from "./types";
import { buildWorkQueue, batchLeadIds, minutesLabel, buildDailyMission } from "./work-queue";

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

  it("builds today's mission: total = remaining + done, counting businesses once", () => {
    const cats = buildWorkQueue({ tasks: [task("A", "prepare_video"), task("A", "review_and_send"), task("B", "call")], meetingsToday: [], leads: leadsMap("A", "B") });
    const mission = buildDailyMission(cats, 3);
    expect(mission.remaining).toBe(2); // A and B — a business counts once even with two tasks
    expect(mission.done).toBe(3);
    expect(mission.total).toBe(5);
    expect(mission.estMinutes).toBeGreaterThan(0);
  });
});

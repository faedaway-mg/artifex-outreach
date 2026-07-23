import { describe, it, expect } from "vitest";
import type { Task, TaskType, Lead } from "./types";
import { decideTodaysFocus } from "./today";

const NOW = new Date("2026-07-23T09:00:00Z");
const lead = (id: string, businessName: string, recommendationReason = ""): Lead => ({ id, businessName, recommendationReason } as unknown as Lead);
const task = (leadId: string, type: TaskType, priority = 1): Task => ({ id: `t_${leadId}_${type}`, leadId, type, title: "", dueAt: "2026-07-23T00:00:00Z", status: "open", priority, snoozedUntil: null, createdAt: "", updatedAt: "" } as Task);
const leadsMap = (...ls: Lead[]) => new Map(ls.map((l) => [l.id, l]));

describe("decideTodaysFocus — one action, decided for the operator", () => {
  it("a booked conversation today beats everything else (time-bound wins)", () => {
    const f = decideTodaysFocus({
      tasks: [task("L2", "review_and_send")],
      leads: leadsMap(lead("L1", "Coastal Dental"), lead("L2", "Bright Smiles")),
      meetingsToday: [{ leadId: "L1", scheduledAt: "2026-07-23T15:00:00Z" }],
      now: NOW,
    });
    expect(f.kind).toBe("conversation");
    expect(f.headline).toContain("Coastal Dental");
    expect(f.ctaHref).toBe("/conversation/L1");
    expect(f.remaining).toBe(1); // the other task is deferred, referenced not shown
  });

  it("otherwise picks the single top prioritized task with one CTA", () => {
    const f = decideTodaysFocus({
      tasks: [task("L1", "prepare_video"), task("L2", "review")],
      leads: leadsMap(lead("L1", "Coastal Dental"), lead("L2", "Bright Smiles")),
      meetingsToday: [], now: NOW,
    });
    expect(f.kind).toBe("video");
    expect(f.headline).toBe("Record a short intro video for Coastal Dental.");
    expect(f.ctaHref).toBe("/leads/L1/send");
    expect(f.remaining).toBe(1);
  });

  it("uses the business-specific reason when we have one", () => {
    const f = decideTodaysFocus({
      tasks: [task("L1", "call")],
      leads: leadsMap(lead("L1", "Coastal Dental", "They replied warmly and asked about pricing.")),
      meetingsToday: [], now: NOW,
    });
    expect(f.why).toBe("They replied warmly and asked about pricing.");
  });

  it("maps each task type to a clear imperative + destination", () => {
    const cases: Array<[TaskType, string]> = [
      ["review", "/leads/L1"],
      ["review_and_send", "/leads/L1/send"],
      ["follow_up", "/leads/L1/send"],
      ["prepare_meeting", "/leads/L1/discovery"],
      ["prepare_proposal", "/leads/L1/review"],
    ];
    for (const [type, href] of cases) {
      const f = decideTodaysFocus({ tasks: [task("L1", type)], leads: leadsMap(lead("L1", "X Co")), meetingsToday: [], now: NOW });
      expect(f.ctaHref).toBe(href);
      expect(f.headline.length).toBeGreaterThan(0);
      expect(f.why.length).toBeGreaterThan(0);
    }
  });

  it("says plainly when there's nothing to do — no invented urgency", () => {
    const f = decideTodaysFocus({ tasks: [], leads: leadsMap(), meetingsToday: [], now: NOW });
    expect(f.kind).toBe("clear");
    expect(f.remaining).toBe(0);
    expect(f.businessName).toBeNull();
  });
});

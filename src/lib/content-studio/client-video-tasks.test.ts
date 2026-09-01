import { describe, it, expect } from "vitest";
import { pendingClientVideoLeadIds, pendingClientVideoCount, type TaskLike } from "./client-video-tasks";
import { computeWorkerHealth } from "./worker-health";

const T = (leadId: string, type: string, status: string): TaskLike => ({ leadId, type, status });

describe("canonical client-video count (section C)", () => {
  it("counts distinct leads with an open prepare_video task", () => {
    const tasks = [T("a", "prepare_video", "open"), T("a", "prepare_video", "open"), T("b", "prepare_video", "open")];
    expect(pendingClientVideoCount(tasks)).toBe(2); // deduped by lead
    expect([...pendingClientVideoLeadIds(tasks)].sort()).toEqual(["a", "b"]);
  });

  it("ignores non-open and non-video tasks", () => {
    const tasks = [T("a", "prepare_video", "done"), T("b", "review_and_send", "open"), T("c", "prepare_video", "snoozed")];
    expect(pendingClientVideoCount(tasks)).toBe(0);
  });

  it("excludes a lead whose client video is already posted", () => {
    const tasks = [T("a", "prepare_video", "open"), T("b", "prepare_video", "open")];
    // posted map is keyed by piece id; a client-<leadId> posted marker retires that lead.
    expect(pendingClientVideoCount(tasks, ["client-a"])).toBe(1);
    expect([...pendingClientVideoLeadIds(tasks, ["client-a"])]).toEqual(["b"]);
    // a posted Field Note (non-client piece id) never affects the client count.
    expect(pendingClientVideoCount(tasks, ["006"])).toBe(2);
  });

  it("is surface-independent: Today and Content Studio pass the same args → identical count", () => {
    const tasks = [T("a", "prepare_video", "open"), T("b", "prepare_video", "open"), T("b", "prepare_video", "open")];
    const posted = ["client-a"];
    const todayCount = pendingClientVideoCount(tasks, posted);
    const studioCount = pendingClientVideoCount(tasks, posted);
    expect(todayCount).toBe(studioCount);
    expect(todayCount).toBe(1);
  });
});

describe("render-worker heartbeat (section J)", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("is active while a job is progressing recently", () => {
    const h = computeWorkerHealth([{ status: "rendering", updatedAt: iso(30_000), finishedAt: null }], now);
    expect(h.verdict).toBe("active");
    expect(h.rendering).toBe(1);
    expect(h.lastActivityAt).toBe(iso(30_000));
  });

  it("never reports active from a silent queued backlog — that is degraded", () => {
    const h = computeWorkerHealth([{ status: "queued", updatedAt: iso(20 * 60_000), finishedAt: null }], now);
    expect(h.verdict).toBe("degraded");
    expect(h.queued).toBe(1);
  });

  it("flags a stalled rendering job (lease/heartbeat silent) as degraded", () => {
    const h = computeWorkerHealth([{ status: "rendering", updatedAt: iso(20 * 60_000), finishedAt: null }], now);
    expect(h.verdict).toBe("degraded");
    expect(h.stale).toBe(1);
  });

  it("is idle with no active work, surfacing the last completion as the heartbeat", () => {
    const h = computeWorkerHealth([{ status: "ready", updatedAt: iso(60_000), finishedAt: iso(60_000) }], now);
    expect(h.verdict).toBe("idle");
    expect(h.lastCompletedAt).toBe(iso(60_000));
  });
});

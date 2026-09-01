import { describe, it, expect } from "vitest";
import { computeScreenshotHealth, canonicalizeCaptureUrl } from "./screenshot-jobs";

describe("canonical capture URL (section G dedup/cache key)", () => {
  it("drops query + fragment, lower-cases host, normalizes trailing slash", () => {
    expect(canonicalizeCaptureUrl("https://Silver.com/Shop/?utm=x#frag")).toBe("https://silver.com/Shop");
    expect(canonicalizeCaptureUrl("https://silver.com/")).toBe("https://silver.com/");
    expect(canonicalizeCaptureUrl("https://silver.com")).toBe("https://silver.com/");
    // path case is preserved (paths can be case-sensitive), only the host is normalized
    expect(canonicalizeCaptureUrl("https://silver.com/Shop/")).toBe("https://silver.com/Shop");
  });
});

describe("screenshot-worker health (section G)", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("is active while a capture is progressing recently", () => {
    const h = computeScreenshotHealth([{ status: "capturing", updatedAt: iso(20_000), finishedAt: null }], now);
    expect(h.verdict).toBe("active");
    expect(h.capturing).toBe(1);
  });

  it("never reports active from a silent queued backlog — that is degraded", () => {
    const h = computeScreenshotHealth([{ status: "queued", updatedAt: iso(10 * 60_000), finishedAt: null }], now);
    expect(h.verdict).toBe("degraded");
    expect(h.queued).toBe(1);
  });

  it("flags a stalled capture (lease/heartbeat silent) as degraded", () => {
    const h = computeScreenshotHealth([{ status: "capturing", updatedAt: iso(10 * 60_000), finishedAt: null }], now);
    expect(h.verdict).toBe("degraded");
    expect(h.stale).toBe(1);
  });

  it("is idle with no active work, surfacing the last completion as the heartbeat", () => {
    const h = computeScreenshotHealth([{ status: "ready", updatedAt: iso(30_000), finishedAt: iso(30_000) }], now);
    expect(h.verdict).toBe("idle");
    expect(h.lastCompletedAt).toBe(iso(30_000));
  });
});

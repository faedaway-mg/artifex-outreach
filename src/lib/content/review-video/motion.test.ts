// Deterministic motion math (M2) — easing, keyframe interpolation, and scene scheduling. These drive
// every rendered frame, so they must be pure and reproducible (no randomness, no wall-clock).
import { describe, it, expect } from "vitest";
import { bezier, progress, track, buildSchedule, totalDuration, stagger, EASE, MOTIONS } from "./motion";

describe("cubic-bezier easing", () => {
  it("pins endpoints and stays within [0,1], monotonic non-decreasing", () => {
    expect(bezier(EASE.out, 0)).toBe(0);
    expect(bezier(EASE.out, 1)).toBe(1);
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.1) { const y = bezier(EASE.out, u); expect(y).toBeGreaterThanOrEqual(-1e-6); expect(y).toBeLessThanOrEqual(1 + 1e-6); expect(y).toBeGreaterThanOrEqual(prev - 1e-6); prev = y; }
  });
  it("ease-out is ahead of linear in the first half (fast-in feel)", () => {
    expect(bezier(EASE.out, 0.25)).toBeGreaterThan(0.25);
  });
  it("is deterministic (same input → same output)", () => {
    expect(bezier(EASE.out, 0.42)).toBe(bezier(EASE.out, 0.42));
  });
});

describe("progress + track", () => {
  it("progress is 0 before start, 1 after end", () => {
    expect(progress(1, 2, 1)).toBe(0);
    expect(progress(4, 2, 1)).toBe(1);
    expect(progress(2.5, 2, 1)).toBeGreaterThan(0);
    expect(progress(2.5, 2, 1)).toBeLessThan(1);
  });
  it("track interpolates between keyframes and holds endpoints", () => {
    const keys: Array<[number, number]> = [[0, 0], [1, 100]];
    expect(track(-1, keys)).toBe(0);
    expect(track(2, keys)).toBe(100);
    const mid = track(0.5, keys);
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(100);
  });
});

describe("scene schedule", () => {
  it("builds contiguous non-overlapping windows covering the total", () => {
    const s = buildSchedule(["a", "b", "c"], [3, 5, 2]);
    expect(s.map((w) => w.durSec)).toEqual([3, 5, 2]);
    expect(s[0].startSec).toBe(0);
    for (let i = 1; i < s.length; i++) expect(s[i].startSec).toBe(s[i - 1].endSec);
    expect(totalDuration(s)).toBe(10);
  });
  it("enforces a minimum scene duration", () => {
    expect(buildSchedule(["a"], [0.1])[0].durSec).toBeGreaterThanOrEqual(0.5);
  });
});

describe("motion grammar config", () => {
  it("stagger offsets increase per index", () => {
    expect(stagger(0)).toBe(0); expect(stagger(2)).toBeGreaterThan(stagger(1));
  });
  it("named primitives exist with sane timing", () => {
    for (const k of ["TextReveal", "NumberImpact", "SurfacePush", "MaskReveal", "Carry"]) {
      expect(MOTIONS[k]).toBeTruthy();
      expect(MOTIONS[k].in).toBeGreaterThan(0);
      expect(MOTIONS[k].ease).toHaveLength(4);
    }
  });
});

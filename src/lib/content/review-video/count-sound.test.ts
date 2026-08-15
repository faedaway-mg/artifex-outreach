// Count-up + sound-event primitives (M2.2) — exact endpoints, no overshoot, deterministic; restrained
// sound events derived from the timeline, mapped to visual events, gains safely under the voice.
import { describe, it, expect } from "vitest";
import { parseStat, countAt, formatCount, countText } from "./count";
import { deriveSoundEvents, sfxRecipe, SFX_GAIN } from "./sound";
import { buildSchedule } from "./motion";
import type { PageScene } from "./scene-plan";

describe("count-up — parse", () => {
  it("parses integer, +suffix, decimal, and symbol", () => {
    expect(parseStat("19")).toMatchObject({ to: 19, decimals: 0, suffix: "" });
    expect(parseStat("950+")).toMatchObject({ to: 950, decimals: 0, suffix: "+" });
    expect(parseStat("4.8")).toMatchObject({ to: 4.8, decimals: 1, suffix: "" });
    expect(parseStat("4.8★")).toMatchObject({ to: 4.8, decimals: 1, suffix: " ★" });
    expect(parseStat("1,250+")).toMatchObject({ to: 1250, suffix: "+" });
    expect(parseStat("no number here")).toBeNull();
  });
});

describe("count-up — animation", () => {
  const spec = { ...parseStat("19")!, startSec: 2, endSec: 3.5 };
  it("is exactly `from` before start and exactly `to` at/after end (no overshoot)", () => {
    expect(countAt(spec, 1)).toBe(0);
    expect(countAt(spec, 3.5)).toBe(19);
    expect(countAt(spec, 10)).toBe(19);
    for (let t = 2; t <= 3.5; t += 0.1) expect(countAt(spec, t)).toBeLessThanOrEqual(19 + 1e-9); // never exceeds truth
  });
  it("is monotonic non-decreasing through the rise", () => {
    let prev = -1;
    for (let t = 2; t <= 3.5; t += 0.05) { const v = countAt(spec, t); expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
  });
  it("formats decimals + suffix; the suffix is never counted", () => {
    const rating = { ...parseStat("4.8★")!, startSec: 0, endSec: 1 };
    expect(formatCount(0, rating)).toBe("0.0 ★");
    expect(formatCount(4.8, rating)).toBe("4.8 ★");
    expect(countText({ ...parseStat("950+")!, startSec: 0, endSec: 1 }, 1)).toBe("950+"); // exact endpoint w/ suffix
  });
  it("decimals endpoint is exact (0.0 → 4.8, lands on 4.8)", () => {
    const r = { ...parseStat("4.8")!, startSec: 0, endSec: 2 };
    expect(countAt(r, 2)).toBeCloseTo(4.8, 6);
  });
});

describe("sound events — derived, restrained, deterministic", () => {
  const scene = (id: string, type: PageScene["type"], surface = false): PageScene => ({ id, type, start: 0, end: 0, surface: surface ? ({} as any) : null });
  const scenes: PageScene[] = [scene("opening", "OPENING_HOOK", true), scene("finding-01", "TEXT", true), scene("finding-02", "STRUCTURE", true), scene("finding-03", "COMPARISON", true), scene("starting-point", "STARTING_POINT"), scene("close", "CLOSE")];
  const schedule = buildSchedule(scenes.map((s) => s.id), [3, 8, 10, 12, 14, 2.4]);
  const events = deriveSoundEvents(scenes, schedule);

  it("a stat scene gets a SOFT_IMPACT at its count resolve", () => {
    expect(events.some((e) => e.sceneId === "finding-02" && e.type === "SOFT_IMPACT")).toBe(true);
  });
  it("the comparison scene gets TWO impacts (950+ then 4.8★), the second slightly later", () => {
    const cmp = events.filter((e) => e.sceneId === "finding-03" && e.type === "SOFT_IMPACT").sort((a, b) => a.at - b.at);
    expect(cmp).toHaveLength(2);
    expect(cmp[1].at).toBeGreaterThan(cmp[0].at);
  });
  it("surface-backed scene changes whoosh; the payoff swells; the close punctuates", () => {
    expect(events.some((e) => e.type === "AIR_WHOOSH")).toBe(true);
    expect(events.some((e) => e.type === "PAYOFF_SWELL" && e.sceneId === "starting-point")).toBe(true);
    expect(events.some((e) => e.type === "ARTIFEX_CLOSE" && e.sceneId === "close")).toBe(true);
  });
  it("the first scene has no incoming transition; events are time-ordered and de-duped", () => {
    expect(events.some((e) => e.sceneId === "opening" && (e.type === "AIR_WHOOSH" || e.type === "SOFT_TRANSITION"))).toBe(false);
    for (let i = 1; i < events.length; i++) expect(events[i].at).toBeGreaterThanOrEqual(events[i - 1].at);
  });
  it("every gain is conservatively low (well under the voice) and non-clipping", () => {
    for (const e of events) { expect(e.gain).toBeGreaterThan(0); expect(e.gain).toBeLessThanOrEqual(0.2); }
    for (const g of Object.values(SFX_GAIN)) expect(g).toBeLessThanOrEqual(0.2);
  });
  it("every sound type has a bounded ffmpeg recipe", () => {
    for (const t of ["SOFT_IMPACT", "AIR_WHOOSH", "SOFT_TRANSITION", "PAYOFF_SWELL", "ARTIFEX_CLOSE"] as const) {
      const r = sfxRecipe(t); expect(r.src.length).toBeGreaterThan(0); expect(r.dur).toBeGreaterThan(0); expect(r.dur).toBeLessThanOrEqual(2);
    }
  });
});

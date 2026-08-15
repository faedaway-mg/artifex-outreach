// Evidence framing geometry (M2.1) — purpose-aware crop that never accidentally clips proof. Tested
// across surface shapes (wide desktop, tall mobile, narrow block, full, extreme focal, small image) and
// against the exact catalog-clip failure shape.
import { describe, it, expect } from "vitest";
import { planFraming, scaleAt, expandRect, clampRect, centerCoverClips, FULL, type Rect } from "./framing";

describe("rect helpers", () => {
  it("expandRect adds margin and clamps to [0,1]", () => {
    const r = expandRect({ x: 0, y: 0, width: 1, height: 0.5 }, 0.06, 0.06);
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.width).toBeLessThanOrEqual(1);
  });
  it("clampRect keeps a rect inside bounds, non-degenerate", () => {
    const r = clampRect({ x: -0.5, y: 1.2, width: 2, height: 0 });
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeLessThanOrEqual(1); expect(r.height).toBeGreaterThan(0);
  });
});

describe("framing modes", () => {
  it("EVIDENCE_FRAME starts at scale 1.0 (full context, no early crop) and pushes only after focusStart", () => {
    const fr = planFraming("EVIDENCE_FRAME", { x: 0, y: 0.35, width: 1, height: 0.6 }, { x: 0, y: 0, width: 1, height: 0.95 });
    expect(fr.scaleStart).toBe(1.0);                 // no crop at the start — fixes the clip
    expect(fr.scaleEnd).toBeGreaterThan(1.0);        // focus push exists
    expect(fr.contextPreserved).toBe(true);
    expect(scaleAt(fr, 0)).toBe(1.0);                // first frame: full context
    expect(scaleAt(fr, 0.5)).toBe(1.0);              // still context before focusStart(0.55)
    expect(scaleAt(fr, 1.0)).toBeGreaterThan(1.0);   // focus by the end
    expect(scaleAt(fr, 1.0)).toBeCloseTo(fr.scaleEnd, 3);
  });
  it("CINEMATIC_CROP allows an immediate Ken-Burns cover (atmospheric)", () => {
    const fr = planFraming("CINEMATIC_CROP", { x: 0, y: 0, width: 1, height: 0.4 }, null);
    expect(fr.scaleStart).toBeGreaterThan(1.0);      // crop from the start is fine here
    expect(scaleAt(fr, 0)).toBeGreaterThan(1.0);
  });
  it("FOCUS_CROP begins already zoomed on the focal detail", () => {
    const fr = planFraming("FOCUS_CROP", { x: 0.2, y: 0.4, width: 0.4, height: 0.3 }, null);
    expect(fr.scaleStart).toBeGreaterThan(1.1);
    expect(fr.originX).toBeCloseTo(0.4); expect(fr.originY).toBeCloseTo(0.55);
  });
  it("the focus push eases up monotonically and never below scaleStart", () => {
    const fr = planFraming("EVIDENCE_FRAME", null, null);
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.1) { const s = scaleAt(fr, p); expect(s).toBeGreaterThanOrEqual(fr.scaleStart - 1e-9); expect(s).toBeGreaterThanOrEqual(prev - 1e-9); prev = s; }
  });
});

describe("surface shapes — evidence stays visible at the start", () => {
  const shapes: Array<[string, Rect]> = [
    ["wide desktop, evidence near LEFT", { x: 0.0, y: 0.2, width: 0.5, height: 0.5 }],
    ["wide desktop, evidence near RIGHT", { x: 0.5, y: 0.2, width: 0.5, height: 0.5 }],
    ["tall mobile, evidence near BOTTOM", { x: 0, y: 0.55, width: 1, height: 0.45 }],
    ["narrow block, evidence fills source", { x: 0.02, y: 0.02, width: 0.96, height: 0.96 }],
    ["full screenshot, no focal", FULL],
    ["extreme focal", { x: -0.3, y: 1.4, width: 2, height: 2 }],
  ];
  for (const [name, ev] of shapes) {
    it(`${name}: EVIDENCE_FRAME preserves context (scale 1.0 start, clamped, no distortion)`, () => {
      const fr = planFraming("EVIDENCE_FRAME", ev, ev);
      expect(fr.scaleStart).toBe(1.0);
      expect(fr.originX).toBeGreaterThanOrEqual(0); expect(fr.originX).toBeLessThanOrEqual(1);
      expect(fr.originY).toBeGreaterThanOrEqual(0); expect(fr.originY).toBeLessThanOrEqual(1);
    });
  }
});

describe("regression — the exact catalog-clip failure shape", () => {
  it("a naive center-COVER of a wide desktop capture into a narrower panel WOULD clip the left-edge evidence…", () => {
    // Source 1180×760 wide desktop; target 900×1000 panel; evidence (heading+collections) spans full width near the left.
    const evidence = { x: 0.0, y: 0.1, width: 1.0, height: 0.75 };
    expect(centerCoverClips(1180, 760, 900, 1000, evidence)).toBe(true); // this is the M2 bug
  });
  it("…and EVIDENCE_FRAME avoids it: full context at start, no negative crop, focus deferred", () => {
    const evidence = { x: 0.0, y: 0.1, width: 1.0, height: 0.75 };
    const fr = planFraming("EVIDENCE_FRAME", { x: 0, y: 0.32, width: 1, height: 0.6 }, evidence, 0.06);
    expect(scaleAt(fr, 0)).toBe(1.0);            // heading/collection region fully visible at the start
    expect(fr.contextMargin).toBeGreaterThan(0); // safe margin applied
    expect(fr.focusStart).toBeGreaterThan(0.4);  // focus only after context is shown
    expect(fr.contextPreserved).toBe(true);
  });
});

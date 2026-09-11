import { describe, it, expect } from "vitest";
import {
  assessScenePlanRichness,
  assessRenderedFrameDiversity,
  isStructuredBeatKind,
  STRUCTURED_BEAT_KINDS,
  type FrameSample,
} from "./social-richness";
import type { Beat } from "./template-schema";

// A minimal text-only plan: the old "narrated PowerPoint" shape (title + statements + brand).
function textOnlyBeats(): Beat[] {
  return [
    { type: "title", headline: "A hook", lines: [0] },
    { type: "statement", text: "Point one.", size: "h2", lines: [1] },
    { type: "statement", text: "Point two.", size: "h1", lines: [2] },
    { type: "brand", tagline: "Artifex Labs", lines: [3] },
  ];
}

// A varied plan with two distinct structured (non-text) beat kinds.
function variedBeats(): Beat[] {
  return [
    { type: "title", headline: "A hook", lines: [0] },
    { type: "chain", caption: "Where it breaks", nodes: [{ label: "Form", state: "on" }, { label: "CRM", state: "gap" }], lines: [1] },
    { type: "statement", text: "The point.", size: "h2", lines: [2] },
    { type: "cards", items: [{ label: "A", name: "x" }, { label: "B", name: "y" }], lines: [3] },
    { type: "brand", tagline: "Artifex Labs", lines: [4] },
  ];
}

describe("social-richness — scene plan (pre-render, §44)", () => {
  it("BLOCKS a text-only plan (title/statement/brand only)", () => {
    const r = assessScenePlanRichness({ beats: textOnlyBeats() });
    expect(r.ok).toBe(false);
    expect(r.structuredBeatCount).toBe(0);
    expect(r.distinctBeatKinds).toBe(0);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.join(" ")).toMatch(/text-only|visual variety/i);
  });

  it("PASSES a varied plan with ≥2 distinct structured kinds", () => {
    const r = assessScenePlanRichness({ beats: variedBeats() });
    expect(r.ok).toBe(true);
    expect(r.distinctBeatKinds).toBeGreaterThanOrEqual(2);
    expect(r.structuredBeatCount).toBeGreaterThanOrEqual(2);
    expect(r.issues).toEqual([]);
  });

  it("BLOCKS a single structured kind (only one distinct non-text kind)", () => {
    const beats: Beat[] = [
      { type: "title", headline: "A hook", lines: [0] },
      { type: "chain", caption: "one", nodes: [{ label: "a", state: "on" }, { label: "b", state: "gap" }], lines: [1] },
      { type: "chain", caption: "two", nodes: [{ label: "c", state: "on" }, { label: "d", state: "gap" }], lines: [2] },
      { type: "brand", tagline: "Artifex Labs", lines: [3] },
    ];
    const r = assessScenePlanRichness({ beats });
    expect(r.ok).toBe(false); // 2 structured beats but only 1 distinct kind → not enough variety
    expect(r.distinctBeatKinds).toBe(1);
  });

  it("STRUCTURED_BEAT_KINDS are recognized; text kinds are not", () => {
    for (const k of STRUCTURED_BEAT_KINDS) expect(isStructuredBeatKind(k)).toBe(true);
    for (const k of ["title", "statement", "brand"]) expect(isStructuredBeatKind(k)).toBe(false);
  });
});

describe("social-richness — rendered frame diversity (§44)", () => {
  it("FLAGS a single-background, mostly-text run (text on one blue background)", () => {
    // 20 frames, all the same background, held nearly identical the whole time.
    const samples: FrameSample[] = Array.from({ length: 20 }, (_, i) => ({
      sceneId: i < 10 ? "s1" : "s2",
      bgKey: "blue-dark",
      sizeBytes: 100000 + (i % 2), // essentially identical
    }));
    const r = assessRenderedFrameDiversity(samples);
    expect(r.ok).toBe(false);
    expect(r.distinctBackgrounds).toBe(1);
    expect(r.dominantBackgroundShare).toBeCloseTo(1, 5);
    expect(r.issues.join(" ")).toMatch(/one blue background|single background|narrated PowerPoint|barely changes/i);
  });

  it("FLAGS a long run of nearly-identical frames even with 2 backgrounds", () => {
    const samples: FrameSample[] = [
      ...Array.from({ length: 16 }, (_, i) => ({ sceneId: "s1", bgKey: "blue-dark", sizeBytes: 100000 + (i % 2) })),
      ...Array.from({ length: 4 }, (_, i) => ({ sceneId: "s2", bgKey: "teal", sizeBytes: 200000 + i * 5000 })),
    ];
    const r = assessRenderedFrameDiversity(samples);
    expect(r.ok).toBe(false);
    expect(r.longestIdenticalRunShare).toBeGreaterThanOrEqual(0.6);
  });

  it("PASSES a diverse run (multiple backgrounds, changing frames)", () => {
    const bgs = ["title", "chain", "cards", "statement", "brand"];
    const samples: FrameSample[] = Array.from({ length: 20 }, (_, i) => ({
      sceneId: `scene-${Math.floor(i / 4)}`,
      bgKey: bgs[Math.floor(i / 4) % bgs.length],
      sizeBytes: 80000 + i * 6000, // steadily changing (animation)
    }));
    const r = assessRenderedFrameDiversity(samples);
    expect(r.ok).toBe(true);
    expect(r.distinctBackgrounds).toBeGreaterThanOrEqual(2);
    expect(r.distinctScenes).toBeGreaterThanOrEqual(2);
    expect(r.issues).toEqual([]);
  });

  it("uses luma buckets when bgKey is absent", () => {
    const samples: FrameSample[] = Array.from({ length: 12 }, () => ({ sceneId: "s1", luma: 0.12 }));
    const r = assessRenderedFrameDiversity(samples);
    expect(r.ok).toBe(false); // one luma bucket + held constant
    expect(r.distinctBackgrounds).toBe(1);
  });

  it("returns not-ok with an issue on empty samples", () => {
    const r = assessRenderedFrameDiversity([]);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/no frame samples/i);
  });
});

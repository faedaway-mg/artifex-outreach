import { describe, it, expect } from "vitest";
import { assessMedia, combineMediaResults, MEDIA_SAMPLE_PCTS, type MediaProbe, type FrameSample } from "./media-qa";

// A healthy animated landscape explainer: frames stay large and VARY across the whole
// runtime (real motion), audio present and covered. Sizes modelled on the recovered
// Matt cta-conversion asset (46–84KB across 5–95%).
const HEALTHY_SIZES = [72_000, 80_000, 61_000, 55_000, 68_000, 50_000, 84_000, 54_000, 47_000];
function samples(sizes: number[], durationSeconds: number): FrameSample[] {
  return MEDIA_SAMPLE_PCTS.map((pct, i) => ({
    pct,
    atSeconds: (pct / 100) * durationSeconds,
    byteSize: sizes[i] ?? sizes[sizes.length - 1],
  }));
}

function landscapeExplainer(sizes: number[], over = {}): MediaProbe {
  return {
    label: "cta-conversion trust explainer",
    width: 1920,
    height: 1080,
    durationSeconds: 70.9,
    hasAudioStream: true,
    audioDurationSeconds: 65.8,
    samples: samples(sizes, 70.9),
    expectedOrientation: "landscape",
    motionExpected: true,
    narrated: true,
    minDurationSeconds: 20,
    ...over,
  };
}

describe("media timeline QA — healthy asset", () => {
  it("PASSes a real animated landscape explainer with covered narration", () => {
    const r = assessMedia(landscapeExplainer(HEALTHY_SIZES));
    expect(r.status).toBe("PASS");
    expect(r.findings).toHaveLength(0);
    expect(r.aliveThroughPct).toBe(100);
    expect(r.orientation).toBe("landscape");
    expect(r.aspectRatio).toBe("16:9");
  });
});

describe("media timeline QA — the escaped defect (§29 blank-after-opening)", () => {
  it("BLOCKS the exact failure: good opening, blank/static for the rest of a ~65s runtime", () => {
    // Opening frames are meaningful (~72KB) then the render goes blank/static: every
    // remaining frame collapses to ~23.7KB — the real signature of the defective Matt
    // landscape render that escaped to production.
    const blankAfterOpening = [72_000, 70_000, 23_700, 23_700, 23_700, 23_700, 23_700, 23_700, 23_700];
    const r = assessMedia(landscapeExplainer(blankAfterOpening));
    expect(r.status).toBe("BLOCKED");
    const blank = r.findings.find((f) => f.kind === "media.blankTimeline");
    expect(blank).toBeDefined();
    expect(blank!.severity).toBe("BLOCKER");
    // The alive region must be reported as ending early (before 80%).
    expect(r.aliveThroughPct).toBeLessThan(80);
    // The evidence timeline marks the dead frames as not alive (§26).
    expect(r.timeline.filter((t) => !t.alive).length).toBeGreaterThanOrEqual(6);
  });

  it("BLOCKS a fully static video even when no single frame reads as absolutely blank", () => {
    // Every frame is large but near-identical in size → nothing is animating.
    const staticSizes = [61_000, 61_200, 60_900, 61_100, 61_050, 60_950, 61_000, 61_100, 61_000];
    const r = assessMedia(landscapeExplainer(staticSizes));
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "media.static")).toBe(true);
  });
});

describe("media timeline QA — format contract (§8)", () => {
  it("BLOCKS a portrait video served against a landscape explainer contract", () => {
    const r = assessMedia(landscapeExplainer(HEALTHY_SIZES, { width: 1080, height: 1920 }));
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "media.orientation")).toBe(true);
  });

  it("PASSes a portrait personalized/social video against a portrait contract", () => {
    const r = assessMedia({
      label: "personalized problem video",
      width: 1080,
      height: 1920,
      durationSeconds: 42,
      hasAudioStream: true,
      audioDurationSeconds: 40,
      samples: samples(HEALTHY_SIZES, 42),
      expectedOrientation: "portrait",
      motionExpected: true,
      narrated: true,
    });
    expect(r.status).toBe("PASS");
    expect(r.orientation).toBe("portrait");
    expect(r.aspectRatio).toBe("9:16");
  });
});

describe("media timeline QA — audio / duration coherence (§7)", () => {
  it("BLOCKS a narrated asset with no audio stream", () => {
    const r = assessMedia(landscapeExplainer(HEALTHY_SIZES, { hasAudioStream: false }));
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "media.noAudio")).toBe(true);
  });

  it("BLOCKS a video whose runtime is shorter than the narration (narration cut off)", () => {
    const r = assessMedia(landscapeExplainer(HEALTHY_SIZES, { durationSeconds: 40, audioDurationSeconds: 65.8, samples: samples(HEALTHY_SIZES, 40) }));
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "media.narrationCut")).toBe(true);
  });

  it("WARNS (not blocks) on a long silent brand-frame tail", () => {
    const r = assessMedia(landscapeExplainer(HEALTHY_SIZES, { durationSeconds: 90, audioDurationSeconds: 45, samples: samples(HEALTHY_SIZES, 90) }));
    expect(r.status).toBe("WARNING");
    expect(r.findings.some((f) => f.kind === "media.silentTail")).toBe(true);
  });
});

describe("media timeline QA — nothing inspected fails closed", () => {
  it("BLOCKS when there are no samples", () => {
    const r = assessMedia(landscapeExplainer(HEALTHY_SIZES, { samples: [] }));
    expect(r.status).toBe("BLOCKED");
    expect(r.findings.some((f) => f.kind === "media.notSampled")).toBe(true);
  });

  it("BLOCKS when duration is unknown / zero", () => {
    const r = assessMedia(landscapeExplainer(HEALTHY_SIZES, { durationSeconds: 0 }));
    expect(r.status).toBe("BLOCKED");
  });
});

describe("media timeline QA — combine", () => {
  it("NOT_RUN with no results, BLOCKED when any asset is blocked", () => {
    expect(combineMediaResults([]).status).toBe("NOT_RUN");
    const good = assessMedia(landscapeExplainer(HEALTHY_SIZES));
    const bad = assessMedia(landscapeExplainer([72_000, 70_000, 23_700, 23_700, 23_700, 23_700, 23_700, 23_700, 23_700]));
    expect(combineMediaResults([good, bad]).status).toBe("BLOCKED");
    expect(combineMediaResults([good, bad]).blocked).toHaveLength(1);
  });
});

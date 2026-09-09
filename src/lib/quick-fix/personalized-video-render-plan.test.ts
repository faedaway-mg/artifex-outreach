import { describe, it, expect } from "vitest";
import type { VideoStoryboard, VideoScene } from "./personalized-video";
import { PV_NARRATION_VERSION } from "./personalized-video";
import {
  buildPersonalizedVideoRenderPlan,
  buildVtt,
  formatVttTimestamp,
  PV_PLAN_FPS,
  PV_PLAN_WIDTH,
  PV_PLAN_HEIGHT,
  PV_PLAN_VERSION,
  PV_MAX_TOTAL_SECONDS,
  PV_MIN_SCENE_SECONDS,
  PV_MAX_SCENE_SECONDS,
  type VttCue,
} from "./personalized-video-render-plan";

// ── Storyboard fixtures (pure — no DB/repo). Mirror buildVideoStoryboard's shape. ──
function scene(partial: Partial<VideoScene> & { narration: string }): VideoScene {
  return {
    role: partial.role ?? "context",
    narration: partial.narration,
    visual: partial.visual ?? { kind: "kinetic-text", screenshotId: null, label: "Acme", illustrative: false },
    claimsAttemptedUse: partial.claimsAttemptedUse ?? false,
    seconds: partial.seconds ?? 3,
  };
}

function buildableStoryboard(scenes: VideoScene[]): VideoStoryboard {
  const narrationScript = scenes.map((s) => s.narration).join(" ");
  return {
    offerId: "qfo_test",
    company: "Acme Co",
    frameVersion: "experience.v1",
    narrationVersion: PV_NARRATION_VERSION,
    buildable: true,
    blockedReason: null,
    scenes,
    narrationScript,
    estimatedSeconds: Math.round(scenes.reduce((n, s) => n + s.seconds, 0) * 10) / 10,
    attemptedUseHonest: true,
  };
}

const CANONICAL_SCENES: VideoScene[] = [
  scene({ role: "context", narration: "We took a close look at Acme's website.", seconds: 3 }),
  scene({ role: "observed", narration: "Some of the text was hard to read on the pages we checked.", seconds: 3.5 }),
  scene({
    role: "evidence",
    narration: "Here's your homepage on a computer — the page exactly as it loads today.",
    seconds: 4,
    visual: { kind: "screenshot", screenshotId: "lead_1:desktop", label: "Your homepage on a computer", illustrative: false },
  }),
  scene({
    role: "friction",
    narration: "The primary button was hard to spot.",
    seconds: 3,
    visual: { kind: "screenshot", screenshotId: "lead_1:desktop", label: "Your homepage on a computer", illustrative: false },
  }),
  scene({
    role: "repair",
    narration: "We'd sharpen the primary action, then check it on phone and desktop.",
    seconds: 4,
    visual: { kind: "repair-concept", screenshotId: null, label: "What we'd change", illustrative: true },
  }),
  scene({ role: "handoff", narration: "Below you'll find exactly what we found, what the fix includes, and the next step.", seconds: 4 }),
];

describe("buildPersonalizedVideoRenderPlan — buildable plan", () => {
  const sb = buildableStoryboard(CANONICAL_SCENES);
  const plan = buildPersonalizedVideoRenderPlan(sb);

  it("is buildable with the canonical dimensions + version", () => {
    expect(plan.buildable).toBe(true);
    expect(plan.blockedReason).toBeNull();
    expect(plan.width).toBe(PV_PLAN_WIDTH);
    expect(plan.height).toBe(PV_PLAN_HEIGHT);
    expect(plan.fps).toBe(PV_PLAN_FPS);
    expect(plan.planVersion).toBe(PV_PLAN_VERSION);
  });

  it("maps scenes 1:1 with the storyboard (no invented or dropped scenes)", () => {
    expect(plan.scenes).toHaveLength(CANONICAL_SCENES.length);
    plan.scenes.forEach((s, i) => {
      expect(s.text).toBe(CANONICAL_SCENES[i].narration);
      expect(s.role).toBe(CANONICAL_SCENES[i].role);
      expect(s.index).toBe(i);
    });
  });

  it("lays scenes end-to-end with contiguous, monotonic frame windows", () => {
    let expectedStart = 0;
    for (const s of plan.scenes) {
      expect(s.startFrame).toBe(expectedStart);
      expect(s.frames).toBeGreaterThanOrEqual(1);
      expect(s.endSeconds).toBeGreaterThan(s.startSeconds);
      expectedStart += s.frames;
    }
    expect(plan.totalFrames).toBe(expectedStart);
    expect(plan.totalFrames).toBe(plan.scenes.reduce((n, s) => n + s.frames, 0));
    expect(plan.totalSeconds).toBeCloseTo(plan.totalFrames / plan.fps, 6);
  });

  it("carries the real screenshot id for screenshot scenes, and null for others", () => {
    const evidence = plan.scenes.find((s) => s.role === "evidence")!;
    expect(evidence.visualSpec.kind).toBe("screenshot");
    expect(evidence.visualSpec.screenshotId).toBe("lead_1:desktop");
    expect(evidence.visualSpec.illustrative).toBe(false);
    expect(evidence.visualSpec.watermark).toBeNull();

    const context = plan.scenes.find((s) => s.role === "context")!;
    expect(context.visualSpec.kind).toBe("kinetic-text");
    expect(context.visualSpec.screenshotId).toBeNull();
  });

  it("flags illustrative (repair-concept) scenes and forces a watermark; never a screenshot", () => {
    const repair = plan.scenes.find((s) => s.role === "repair")!;
    expect(repair.visualSpec.kind).toBe("repair-concept");
    expect(repair.visualSpec.illustrative).toBe(true);
    expect(repair.visualSpec.watermark).toBeTruthy();
    expect(repair.visualSpec.watermark!.toLowerCase()).toMatch(/example|illustrative/);
    // A repair-concept must NEVER composite a real captured screenshot.
    expect(repair.visualSpec.screenshotId).toBeNull();
  });

  it("clamps each scene's duration within [min, max] seconds", () => {
    for (const s of plan.scenes) {
      expect(s.seconds).toBeGreaterThanOrEqual(PV_MIN_SCENE_SECONDS - 1 / plan.fps);
      expect(s.seconds).toBeLessThanOrEqual(PV_MAX_SCENE_SECONDS + 1 / plan.fps);
    }
  });

  it("bounds total frames under the hard cap and is not clamped for a normal storyboard", () => {
    expect(plan.clampedToCap).toBe(false);
    expect(plan.totalFrames).toBeLessThanOrEqual(PV_MAX_TOTAL_SECONDS * plan.fps);
    expect(plan.totalFrames).toBeGreaterThan(0);
  });

  it("is deterministic — identical storyboard yields an identical plan", () => {
    const a = buildPersonalizedVideoRenderPlan(sb);
    const b = buildPersonalizedVideoRenderPlan(buildableStoryboard(CANONICAL_SCENES));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("VTT captions", () => {
  const sb = buildableStoryboard(CANONICAL_SCENES);
  const plan = buildPersonalizedVideoRenderPlan(sb);

  it("emits one cue per scene, in order, verbatim from the narration", () => {
    expect(plan.vttCues).toHaveLength(CANONICAL_SCENES.length);
    plan.vttCues.forEach((c, i) => {
      expect(c.text).toBe(CANONICAL_SCENES[i].narration);
    });
    expect(plan.captionsVerbatim).toBe(true);
  });

  it("has monotonic non-overlapping cue windows aligned to the scene frames", () => {
    let prevEnd = 0;
    plan.vttCues.forEach((c, i) => {
      expect(c.startSeconds).toBeGreaterThanOrEqual(prevEnd - 1e-9);
      expect(c.endSeconds).toBeGreaterThan(c.startSeconds);
      // Cue window equals the scene's frame window.
      expect(c.startSeconds).toBeCloseTo(plan.scenes[i].startSeconds, 6);
      expect(c.endSeconds).toBeCloseTo(plan.scenes[i].endSeconds, 6);
      prevEnd = c.endSeconds;
    });
    // Last cue ends at the video's total duration.
    expect(prevEnd).toBeCloseTo(plan.totalSeconds, 6);
  });

  it("produces a well-formed WebVTT document containing every narration line", () => {
    expect(plan.vtt.startsWith("WEBVTT")).toBe(true);
    for (const s of CANONICAL_SCENES) expect(plan.vtt).toContain(s.narration);
    // One `-->` per cue.
    const arrows = plan.vtt.match(/-->/g) ?? [];
    expect(arrows).toHaveLength(CANONICAL_SCENES.length);
  });

  it("the caption track equals a VTT rebuilt directly from the plan's cues (verbatim source)", () => {
    expect(plan.vtt).toBe(buildVtt(plan.vttCues));
  });
});

describe("formatVttTimestamp", () => {
  it("formats seconds as HH:MM:SS.mmm", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    expect(formatVttTimestamp(1.5)).toBe("00:00:01.500");
    expect(formatVttTimestamp(61.25)).toBe("00:01:01.250");
    expect(formatVttTimestamp(3661.001)).toBe("01:01:01.001");
  });
  it("never emits a negative timestamp", () => {
    expect(formatVttTimestamp(-5)).toBe("00:00:00.000");
  });
});

describe("buildPersonalizedVideoRenderPlan — bounding / cap", () => {
  it("scales down proportionally and hits the cap when the storyboard is too long", () => {
    // 40 scenes × ~9s ≫ 90s cap → must clamp.
    const many: VideoScene[] = Array.from({ length: 40 }, (_, i) =>
      scene({ narration: `Line number ${i} explaining a real observed finding on the site.`, seconds: 9 }),
    );
    const plan = buildPersonalizedVideoRenderPlan(buildableStoryboard(many));
    expect(plan.clampedToCap).toBe(true);
    expect(plan.totalFrames).toBeLessThanOrEqual(PV_MAX_TOTAL_SECONDS * plan.fps);
    // Every scene still present with ≥1 frame (nothing dropped).
    expect(plan.scenes).toHaveLength(40);
    for (const s of plan.scenes) expect(s.frames).toBeGreaterThanOrEqual(1);
    // Captions still one-per-scene and verbatim after scaling.
    expect(plan.vttCues).toHaveLength(40);
    expect(plan.captionsVerbatim).toBe(true);
  });

  it("honors a custom fps/cap while staying bounded + contiguous", () => {
    const plan = buildPersonalizedVideoRenderPlan(buildableStoryboard(CANONICAL_SCENES), {
      fps: 30,
      maxTotalSeconds: 10,
      width: 720,
      height: 1280,
    });
    expect(plan.fps).toBe(30);
    expect(plan.width).toBe(720);
    expect(plan.height).toBe(1280);
    expect(plan.totalFrames).toBeLessThanOrEqual(10 * 30);
    let cursor = 0;
    for (const s of plan.scenes) {
      expect(s.startFrame).toBe(cursor);
      cursor += s.frames;
    }
  });

  it("clamps a zero/negative scene duration up to the minimum", () => {
    const plan = buildPersonalizedVideoRenderPlan(
      buildableStoryboard([scene({ narration: "Tiny.", seconds: 0 }), scene({ narration: "Also tiny.", seconds: -3 })]),
    );
    for (const s of plan.scenes) {
      expect(s.frames).toBeGreaterThanOrEqual(Math.round(PV_MIN_SCENE_SECONDS * plan.fps) - 1);
    }
  });
});

describe("buildPersonalizedVideoRenderPlan — non-buildable storyboard", () => {
  it("returns an empty, non-buildable plan with an honest reason and an empty VTT", () => {
    const blocked: VideoStoryboard = {
      offerId: "qfo_blocked",
      company: "Acme Co",
      frameVersion: "experience.v1",
      narrationVersion: PV_NARRATION_VERSION,
      buildable: false,
      blockedReason: "No evidence-backed findings — there is nothing to walk through honestly.",
      scenes: [],
      narrationScript: "",
      estimatedSeconds: 0,
      attemptedUseHonest: true,
    };
    const plan = buildPersonalizedVideoRenderPlan(blocked);
    expect(plan.buildable).toBe(false);
    expect(plan.blockedReason).toContain("No evidence-backed findings");
    expect(plan.scenes).toHaveLength(0);
    expect(plan.totalFrames).toBe(0);
    expect(plan.totalSeconds).toBe(0);
    expect(plan.vtt.trim()).toBe("WEBVTT");
    expect(plan.vttCues).toHaveLength(0);
  });
});

describe("buildVtt (standalone)", () => {
  it("numbers cues from 1 and preserves text exactly", () => {
    const cues: VttCue[] = [
      { index: 0, startSeconds: 0, endSeconds: 2.5, text: "First line." },
      { index: 1, startSeconds: 2.5, endSeconds: 5, text: "Second line — with punctuation!" },
    ];
    const vtt = buildVtt(cues);
    expect(vtt).toContain("1\n00:00:00.000 --> 00:00:02.500\nFirst line.");
    expect(vtt).toContain("2\n00:00:02.500 --> 00:00:05.000\nSecond line — with punctuation!");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSONALIZED DIAGNOSTIC VIDEO — RENDER PLAN (PURE).
//
// storyboard → deterministic render plan / timeline spec. This module is the
// important deliverable: it turns the evidence-derived VideoStoryboard into an
// exact, deterministic timeline the render worker replays frame-by-frame, plus a
// WebVTT caption track generated VERBATIM from the authoritative narration lines.
//
// ONE EVIDENCE TRUTH. The plan derives ONLY from the storyboard (which derives
// from the canonical EvidencePackage). It NEVER invents a scene, a defect, or a
// caption line — every plan scene maps 1:1 to a storyboard scene, and every VTT
// cue is the storyboard scene's narration text unchanged. Real-screenshot scenes
// carry a screenshotId to composite the ACTUAL captured PNG; repair-concept scenes
// are flagged illustrative and MUST be watermarked "Example / Illustrative" by the
// renderer — they are never presented as observed evidence.
//
// SILENT v1. There is no spoken audio. The narration lines render as on-screen
// KINETIC TEXT and are ALSO the caption source, so captions and on-screen text are
// the same words by construction — a VTT built from narrationScript is verbatim and
// may be marked captionsVerified without a separate transcript step.
//
// PURE: no I/O, no randomness, no Date.now. Same storyboard → identical plan.
// ─────────────────────────────────────────────────────────────────────────────
import type { VideoStoryboard, VideoScene, SceneRole, SceneVisualKind } from "./personalized-video";

// Vertical 9:16 short — matches the review-video renderer (1080×1920 @ 24fps).
export const PV_PLAN_WIDTH = 1080;
export const PV_PLAN_HEIGHT = 1920;
export const PV_PLAN_FPS = 24;

// Bounded render: a personalized diagnostic short is a walkthrough, not a film. We
// cap total duration hard so a pathological storyboard can never explode the render.
export const PV_MAX_TOTAL_SECONDS = 90; // absolute ceiling on the assembled video
export const PV_MIN_SCENE_SECONDS = 2.2; // floor so a short line still reads
export const PV_MAX_SCENE_SECONDS = 9.0; // ceiling so one line can't hog the timeline

// The caption/plan version — bump when the timeline math or VTT emission changes.
export const PV_PLAN_VERSION = "pv-plan.v1";

/** What the renderer must actually paint for a scene. Derived 1:1 from SceneVisual. */
export interface RenderVisualSpec {
  kind: SceneVisualKind;
  /** For kind==="screenshot": the real captured screenshot to composite (never faked). */
  screenshotId: string | null;
  /** Plain on-screen label. */
  label: string;
  /** True ONLY for repair-concept — the renderer MUST stamp an "Example / Illustrative"
   *  watermark and NEVER present it as observed evidence. */
  illustrative: boolean;
  /** The exact watermark text the renderer must burn in when illustrative (else null). */
  watermark: string | null;
}

export interface RenderScene {
  index: number;
  role: SceneRole;
  /** The authoritative narration line — rendered as on-screen kinetic text AND caption. */
  text: string;
  visualSpec: RenderVisualSpec;
  /** True when this line makes an attempted-use claim (carried through for audit). */
  claimsAttemptedUse: boolean;
  /** This scene's clamped duration in seconds. */
  seconds: number;
  /** Inclusive first frame index of this scene in the assembled timeline. */
  startFrame: number;
  /** Number of frames this scene occupies. */
  frames: number;
  /** Start/end offsets in seconds (frame-quantized) — the caption cue window. */
  startSeconds: number;
  endSeconds: number;
}

export interface VttCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  /** Verbatim narration text — identical to the scene's on-screen kinetic text. */
  text: string;
}

export interface PersonalizedVideoRenderPlan {
  planVersion: string;
  buildable: boolean;
  blockedReason: string | null;
  width: number;
  height: number;
  fps: number;
  scenes: RenderScene[];
  totalFrames: number;
  totalSeconds: number;
  /** True when the assembled duration hit the hard cap and scenes were scaled down. */
  clampedToCap: boolean;
  /** The full WebVTT track, built verbatim from the narration lines. */
  vtt: string;
  vttCues: VttCue[];
  /** True: every cue's text is a scene narration line verbatim → verifiable captions. */
  captionsVerbatim: boolean;
}

const WATERMARK_TEXT = "Example · Illustrative";

function clampSceneSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return PV_MIN_SCENE_SECONDS;
  return Math.min(PV_MAX_SCENE_SECONDS, Math.max(PV_MIN_SCENE_SECONDS, seconds));
}

/** WebVTT timestamp `HH:MM:SS.mmm` from seconds. Deterministic, millisecond-precise. */
export function formatVttTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const ms = Math.round(clamped * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(millis, 3)}`;
}

function visualSpecFor(scene: VideoScene): RenderVisualSpec {
  const illustrative = scene.visual.kind === "repair-concept" || scene.visual.illustrative;
  return {
    kind: scene.visual.kind,
    // A screenshot spec is only honored when the storyboard actually links a capture;
    // never a fabricated one. repair-concept never carries a screenshotId.
    screenshotId: scene.visual.kind === "screenshot" ? scene.visual.screenshotId : null,
    label: scene.visual.label,
    illustrative,
    watermark: illustrative ? WATERMARK_TEXT : null,
  };
}

/**
 * Build the deterministic render plan from a storyboard. The plan is a projection:
 * scenes map 1:1 to storyboard scenes, timing derives from each scene's seconds
 * (clamped), and captions are the narration lines verbatim. If the natural duration
 * exceeds the hard cap, every scene is scaled proportionally so the total lands at
 * the cap (frame counts stay ≥1 so no scene is dropped).
 *
 * A non-buildable storyboard yields an empty, non-buildable plan (nothing to render).
 */
export function buildPersonalizedVideoRenderPlan(
  storyboard: VideoStoryboard,
  opts: { fps?: number; width?: number; height?: number; maxTotalSeconds?: number } = {},
): PersonalizedVideoRenderPlan {
  const fps = opts.fps ?? PV_PLAN_FPS;
  const width = opts.width ?? PV_PLAN_WIDTH;
  const height = opts.height ?? PV_PLAN_HEIGHT;
  const maxTotalSeconds = opts.maxTotalSeconds ?? PV_MAX_TOTAL_SECONDS;

  if (!storyboard.buildable || storyboard.scenes.length === 0) {
    return {
      planVersion: PV_PLAN_VERSION,
      buildable: false,
      blockedReason: storyboard.blockedReason ?? "Storyboard is not buildable — nothing to render.",
      width,
      height,
      fps,
      scenes: [],
      totalFrames: 0,
      totalSeconds: 0,
      clampedToCap: false,
      vtt: "WEBVTT\n\n",
      vttCues: [],
      captionsVerbatim: true,
    };
  }

  // 1) Clamp each scene's seconds, then scale proportionally if we'd exceed the cap.
  const clamped = storyboard.scenes.map((s) => clampSceneSeconds(s.seconds));
  const naturalTotal = clamped.reduce((n, s) => n + s, 0);
  const clampedToCap = naturalTotal > maxTotalSeconds;
  const scale = clampedToCap ? maxTotalSeconds / naturalTotal : 1;

  // 2) Quantize to whole frames (≥1 per scene). Per-scene rounding can push the sum a
  //    frame or two over the cap, so we enforce the frame ceiling as a HARD guarantee:
  //    trim single frames from the longest scenes (never below 1) until we're under it.
  const capFrames = Math.floor(maxTotalSeconds * fps);
  const frameCounts = clamped.map((sec) => Math.max(1, Math.round(sec * scale * fps)));
  if (clampedToCap) {
    let over = frameCounts.reduce((n, f) => n + f, 0) - capFrames;
    while (over > 0) {
      // Find the current longest scene that can still give up a frame.
      let victim = -1;
      let max = 1;
      for (let i = 0; i < frameCounts.length; i++) {
        if (frameCounts[i] > max) {
          max = frameCounts[i];
          victim = i;
        }
      }
      if (victim < 0) break; // every scene is at the floor — cannot trim further
      frameCounts[victim] -= 1;
      over -= 1;
    }
  }

  // 3) Lay the frame-quantized scenes end-to-end.
  const scenes: RenderScene[] = [];
  const cues: VttCue[] = [];
  let cursorFrame = 0;
  storyboard.scenes.forEach((scene, index) => {
    const frames = frameCounts[index];
    const startFrame = cursorFrame;
    const startSeconds = startFrame / fps;
    const endSeconds = (startFrame + frames) / fps;
    const seconds = frames / fps;

    scenes.push({
      index,
      role: scene.role,
      text: scene.narration,
      visualSpec: visualSpecFor(scene),
      claimsAttemptedUse: scene.claimsAttemptedUse,
      seconds,
      startFrame,
      frames,
      startSeconds,
      endSeconds,
    });
    cues.push({ index, startSeconds, endSeconds, text: scene.narration });
    cursorFrame += frames;
  });

  const totalFrames = cursorFrame;
  const totalSeconds = totalFrames / fps;

  // 4) Emit WebVTT verbatim from the narration lines. Cues are monotonic + contiguous
  //    because they inherit the frame-quantized scene windows above.
  const vtt = buildVtt(cues);

  // Captions are verbatim exactly when every cue equals its scene's narration text.
  const captionsVerbatim = cues.every((c, i) => c.text === storyboard.scenes[i].narration);

  return {
    planVersion: PV_PLAN_VERSION,
    buildable: true,
    blockedReason: null,
    width,
    height,
    fps,
    scenes,
    totalFrames,
    totalSeconds,
    clampedToCap,
    vtt,
    vttCues: cues,
    captionsVerbatim,
  };
}

/** Assemble a WebVTT document from cues. Verbatim text; monotonic frame-quantized windows. */
export function buildVtt(cues: VttCue[]): string {
  let out = "WEBVTT\n\n";
  cues.forEach((cue, i) => {
    out += `${i + 1}\n`;
    out += `${formatVttTimestamp(cue.startSeconds)} --> ${formatVttTimestamp(cue.endSeconds)}\n`;
    out += `${cue.text}\n\n`;
  });
  return out;
}

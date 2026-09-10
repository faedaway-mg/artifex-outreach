// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — ZERO-TOUCH ORCHESTRATION PLAN (mandate §17/§18). PURE. Given the
// system-written script, deterministically produces the SOCIAL ANIMATION / SCENE PLAN
// (hook → point/emphasis cards → brand close) in the Artifex 9:16 visual language, plus
// the calm high-level stage. No I/O: the server action executes the side-effecting steps
// (Matt TTS, render, captions) from this plan. The operator chooses the idea; the system
// manufactures the video — this module is the "manufacturing plan".
// ─────────────────────────────────────────────────────────────────────────────
import { SOCIAL_VIDEO_WIDTH, SOCIAL_VIDEO_HEIGHT, SOCIAL_ORIENTATION, SOCIAL_ASPECT_RATIO, wordBudgetForSeconds } from "./zero-touch";

export type SceneKind = "hook" | "point" | "emphasis" | "brand-close";

export interface SocialScene {
  kind: SceneKind;
  text: string;
  seconds: number;
}

export interface SocialScenePlan {
  width: number;
  height: number;
  orientation: typeof SOCIAL_ORIENTATION;
  aspectRatio: typeof SOCIAL_ASPECT_RATIO;
  scenes: SocialScene[];
  totalSeconds: number;
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Deterministic 9:16 social scene plan. The first line is the HOOK; the last line is the
 * BRAND CLOSE; the middle lines alternate POINT / EMPHASIS for kinetic variety. Scene
 * durations are distributed by word count across the target runtime (min 1.2s/scene) so
 * the animation timeline covers the narration. PURE.
 */
export function planSocialAnimation(script: string[], targetSeconds: number): SocialScenePlan {
  const lines = script.map((l) => l.trim()).filter(Boolean);
  const target = Math.max(6, targetSeconds || 0);
  const scenes: SocialScene[] = [];
  if (lines.length === 0) {
    scenes.push({ kind: "hook", text: "", seconds: target });
  } else {
    const totalWords = lines.reduce((n, l) => n + words(l), 0) || 1;
    lines.forEach((line, i) => {
      const kind: SceneKind = i === 0 ? "hook" : i === lines.length - 1 ? "brand-close" : i % 2 === 1 ? "point" : "emphasis";
      const seconds = Math.max(1.2, (words(line) / totalWords) * target);
      scenes.push({ kind, text: line, seconds: Number(seconds.toFixed(2)) });
    });
  }
  const totalSeconds = Number(scenes.reduce((n, s) => n + s.seconds, 0).toFixed(2));
  return {
    width: SOCIAL_VIDEO_WIDTH,
    height: SOCIAL_VIDEO_HEIGHT,
    orientation: SOCIAL_ORIENTATION,
    aspectRatio: SOCIAL_ASPECT_RATIO,
    scenes,
    totalSeconds,
  };
}

// ── The user-facing "next action" for a zero-touch card ──────────────────────
export type ZeroTouchAction = "generate" | "regenerate" | "play" | "waiting";

export interface ZeroTouchCardSignals {
  hasBrief: boolean;
  hasFinishedVideo: boolean;
  generating: boolean; // a render/voice step is in flight
}

/** The single action the normal card offers. Deterministic. */
export function zeroTouchAction(s: ZeroTouchCardSignals): ZeroTouchAction {
  if (s.generating) return "waiting";
  if (s.hasFinishedVideo) return "play";
  if (s.hasBrief) return "generate";
  return "generate";
}

/** Word budget helper re-export for the action layer (keeps one source of truth). */
export { wordBudgetForSeconds };

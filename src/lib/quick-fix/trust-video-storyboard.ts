// ─────────────────────────────────────────────────────────────────────────────
// MATT TRUST-VIDEO STORYBOARD (PURE). Turns a scope's evergreen trust script
// (trustVideoScript(scope)) into a deterministic VideoStoryboard the render pipeline
// consumes — the SAME storyboard/plan machinery the personalized diagnostic video
// uses, so a Matt trust video is just a render of the trust narration with the Matt
// voiceover muxed on.
//
// TRUTH SHAPE (enforced, not just claimed):
//   • ALL scenes are kinetic-text — the trust script is COMPANY-VOICE process language
//     with no per-lead evidence, so there is NO screenshot and NO repair-concept. The
//     storyboard fabricates no interface and links no capture.
//   • NO attempted-use claims — the trust script never says "we tried to …". Every
//     scene sets claimsAttemptedUse=false and the storyboard is attemptedUseHonest.
//   • Deterministic — same scope ⇒ byte-identical storyboard (no I/O, no Date.now, no
//     randomness). The narration revision is a stable content hash.
//
// This module performs NO render, NO ElevenLabs call, NO store I/O. It only derives.
// It never references the legacy Lucas assets and never generates for a Lucas journey.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import {
  trustVideoScript,
  TRUST_VIDEO_NARRATION_VERSION,
  TRUST_VIDEO_SCRIPT_VERSION,
  type TrustVideoScope,
} from "./trust-videos";
import type { VideoStoryboard, VideoScene, SceneRole } from "./personalized-video";

// Bump when the storyboard derivation changes (invalidates a rendered trust narration
// binding). Kept distinct from the script/narration versions so a derivation-only
// change is detectable independently of a script edit.
export const TRUST_STORYBOARD_VERSION = "trust-sb.v1";

const WORDS_PER_SECOND = 2.6; // conversational pace — same pacing as the diagnostic storyboard.
function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
function sceneSeconds(text: string): number {
  // Floor ~2.2s so a short sentence still reads; round to a tenth. Deterministic.
  return Math.max(2.2, Math.round((words(text) / WORDS_PER_SECOND) * 10) / 10);
}

// Split the trust script into sentence-level scenes. Deterministic: sentence-final
// punctuation (. ! ?) followed by whitespace, keeping the punctuation on the sentence.
// Abbreviation-free trust copy makes this safe; each surviving sentence becomes a scene.
function splitSentences(script: string): string[] {
  return script
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Role assignment across the sentence flow: the first sentence is context (who we are /
// the setup), the last is the handoff (that's Artifex Quick-Fix), everything between is
// observed process. All company-voice; none evidence/screenshot/repair-concept.
function roleForIndex(index: number, total: number): SceneRole {
  if (index === 0) return "context";
  if (index === total - 1) return "handoff";
  return "observed";
}

/**
 * Build the deterministic Matt trust-video storyboard for a scope. Every scene is
 * kinetic-text company voice with no attempted-use claim; the storyboard is always
 * buildable (the trust script is evergreen and never empty) and attemptedUseHonest.
 */
export function buildTrustVideoStoryboard(scope: TrustVideoScope): VideoStoryboard {
  const script = trustVideoScript(scope);
  const sentences = splitSentences(script);

  const scenes: VideoScene[] = sentences.map((sentence, index) => ({
    role: roleForIndex(index, sentences.length),
    narration: sentence,
    // Kinetic text only — the trust narration is the hero. No capture, no schematic.
    visual: { kind: "kinetic-text", screenshotId: null, label: "Artifex Quick-Fix", illustrative: false },
    // The trust script makes NO attempted-use claim, ever.
    claimsAttemptedUse: false,
    seconds: sceneSeconds(sentence),
  }));

  const estimatedSeconds = Math.round(scenes.reduce((n, s) => n + s.seconds, 0) * 10) / 10;

  return {
    // A scope-keyed identity, not an offer id — the trust video is shared across leads.
    offerId: `trust:${scope}`,
    company: "Artifex Labs",
    frameVersion: TRUST_STORYBOARD_VERSION,
    narrationVersion: TRUST_VIDEO_NARRATION_VERSION,
    buildable: true,
    blockedReason: null,
    scenes,
    // The full trust script is the authoritative narration + caption source. Rejoining
    // the split sentences with a single space reproduces the original script exactly.
    narrationScript: script,
    estimatedSeconds,
    // No attempted-use claim exists in the trust script → trivially honest.
    attemptedUseHonest: true,
  };
}

/**
 * The stable narration revision for a scope's Matt trust video. It binds the render to
 * the exact (narration version, script version, script text) tuple: any script or
 * version change yields a new revision, which the render pipeline uses to detect a
 * stale Matt asset and (only then) regenerate. Deterministic; 16 hex chars, prefixed.
 */
export function trustNarrationRevision(scope: TrustVideoScope): string {
  const script = trustVideoScript(scope);
  const digest = createHash("sha256")
    .update(`${TRUST_VIDEO_NARRATION_VERSION}|${TRUST_VIDEO_SCRIPT_VERSION}|${script}`)
    .digest("hex")
    .slice(0, 16);
  return `trust1_${digest}`;
}

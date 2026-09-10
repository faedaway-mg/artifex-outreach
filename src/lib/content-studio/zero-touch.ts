// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — ZERO-TOUCH SOCIAL GENERATOR (amendment). The normal operator experience is:
//   title/concept · short brief · [ GENERATE ] → "Creating your video…" → finished playable video.
// One action orchestrates the whole pipeline (script → Matt narration → captions → animation/render →
// finished) and HIDES the production machinery (narration-script editor, Copy Narration, voiceover panel,
// Upload Voiceover, audio-format instructions, separate Generate-Voiceover / Generate-Video). The script,
// voice lineage, plan, captions, render lineage, QA + cost are still preserved — surfaced only in an
// Advanced / Generation-details view, never the normal workflow.
//
// FORMAT CONTRACT: a social Field Note is 9:16 PORTRAIT by default (distinct from the 16:9 landscape
// offer/trust explainer and the 9:16 personalized prospect video). PURE module — no I/O.
// ─────────────────────────────────────────────────────────────────────────────

// Social Field Notes are portrait 9:16 (matches the personalized-video render plan default).
export const SOCIAL_VIDEO_WIDTH = 1080;
export const SOCIAL_VIDEO_HEIGHT = 1920;
export const SOCIAL_ORIENTATION = "portrait" as const;
export const SOCIAL_ASPECT_RATIO = "9:16" as const;

// Matt is the default Artifex social narrator — the normal flow NEVER shows a voice selector. The social
// voice SCOPE stays isolated from the prospect journey voices (a social project never mutates a prospect's
// canonical voice); social + prospect Matt may reference the same approved profile under separate scopes.
export const SOCIAL_DEFAULT_VOICE = "artifex_default"; // Matt
export const SOCIAL_VOICE_SCOPE = "social" as const;

// The customer/operator-facing generation stages — a calm, non-technical progression. Internal pipeline
// states (ElevenLabs request ids, ffmpeg, artifact binding, job hashes, retries) are NEVER surfaced here.
export type ZeroTouchStage = "DRAFT" | "WRITING" | "CREATING_VOICE" | "BUILDING_VIDEO" | "FINISHING" | "READY" | "NEEDS_INPUT" | "FAILED";

export const ZERO_TOUCH_STAGE_LABEL: Record<ZeroTouchStage, string> = {
  DRAFT: "Ready to generate",
  WRITING: "Writing",
  CREATING_VOICE: "Creating voice",
  BUILDING_VIDEO: "Building video",
  FINISHING: "Finishing",
  READY: "Ready",
  NEEDS_INPUT: "Add a brief to generate",
  FAILED: "Generation failed — tap Regenerate",
};

/** The minimal signals the stage derivation needs (a subset of Piece + the active render job status). */
export interface ZeroTouchSignals {
  brief: string | null | undefined;
  hasNarration: boolean;      // a script has been written
  hasVoiceover: boolean;      // Matt narration generated + bound
  renderJobStatus: "none" | "queued" | "rendering" | "ready" | "failed";
  hasFinishedVideo: boolean;  // a playable recommended file exists
}

/**
 * Derive the ONE simplified stage the normal UI shows. Deterministic. Maps the internal pipeline to a calm
 * customer-facing progression; never leaks a technical state.
 */
export function zeroTouchStage(s: ZeroTouchSignals): ZeroTouchStage {
  if (s.hasFinishedVideo && s.renderJobStatus !== "rendering" && s.renderJobStatus !== "queued") return "READY";
  if (s.renderJobStatus === "failed") return "FAILED";
  if (s.renderJobStatus === "rendering") return "BUILDING_VIDEO";
  if (s.renderJobStatus === "queued") return "FINISHING";
  if (s.hasVoiceover) return "BUILDING_VIDEO";      // voice done, render about to run
  if (s.hasNarration) return "CREATING_VOICE";      // script done, generating Matt
  if (s.brief && s.brief.trim()) return "DRAFT";    // a usable brief → Generate-ready
  return "NEEDS_INPUT";
}

/** Whether the normal (non-advanced) view is actively generating (show "Creating your video…"). */
export function isGenerating(stage: ZeroTouchStage): boolean {
  return stage === "WRITING" || stage === "CREATING_VOICE" || stage === "BUILDING_VIDEO" || stage === "FINISHING";
}

// The production-machinery controls that must NEVER appear in the NORMAL Content Studio view (they live in
// Advanced / Generation details only). This list is asserted by the UI tests.
export const HIDDEN_MACHINERY_CONTROLS = [
  "narration-script-editor",
  "copy-narration",
  "line-by-line-narration",
  "voiceover-panel",
  "upload-voiceover",
  "audio-format-instructions",
  "generate-voiceover-button",
  "generate-video-button",
  "attach-render",
  "render-machinery",
] as const;

// ── Brief → script (the system writes its own narration) ─────────────────────
export interface ScriptGenInput {
  brief: string;
  title: string;
  concept?: string | null;
  targetSeconds: number; // constrains length (~2.6 words/sec spoken)
}

/** ~2.6 words/sec conversational pace → target word budget for the spoken script. */
export function wordBudgetForSeconds(targetSeconds: number): number {
  return Math.max(12, Math.round(targetSeconds * 2.6));
}

/**
 * Deterministic offline composer: turn a brief into a paced, Artifex-toned short script (strong hook →
 * one central idea → strong close), budgeted to the target duration. This is the fallback + the test
 * oracle; the route can inject a richer AI generator (generateConstrainedText) for production polish.
 * PURE. Never returns generic filler — it composes from the brief's own sentences.
 */
export function composeScriptFromBrief(input: ScriptGenInput): string[] {
  const budget = wordBudgetForSeconds(input.targetSeconds);
  const hook = (input.concept?.trim() || input.title.trim() || "Here's something worth noticing.").replace(/\s+/g, " ");
  // Split the brief into idea sentences; keep the strongest, drop filler.
  const sentences = input.brief
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const body: string[] = [];
  let used = words(hook);
  for (const s of sentences) {
    const w = words(s);
    if (used + w > budget && body.length >= 1) break; // stay within the duration budget
    body.push(s.endsWith(".") || s.endsWith("!") || s.endsWith("?") ? s : `${s}.`);
    used += w;
  }
  if (body.length === 0 && sentences.length > 0) body.push(sentences[0]);
  const close = "That's the kind of problem Artifex fixes.";
  return [hook, ...body, close].filter(Boolean);
}

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** The full spoken script (lines joined) — the caption + TTS source. */
export function scriptText(lines: string[]): string {
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

// ── One-action Generate: the ordered pipeline the orchestrator runs ──────────
// Documented here (executed by the Generate route) so it is a single source of truth:
//   1) ensure a script (brief → composeScriptFromBrief / AI) when narration is empty
//   2) generate (or REUSE) the Matt social voiceover — never a voice choice in the normal flow
//   3) persist + bind the audio to the exact script revision
//   4) enqueue the render (portrait 9:16); the worker assembles animation + captions + video
//   5) on a render RETRY, REUSE the existing Matt audio — never re-spend ElevenLabs for a render failure
export const ZERO_TOUCH_PIPELINE = [
  "write-script", "create-voice", "persist-audio", "enqueue-render", "reuse-audio-on-retry",
] as const;

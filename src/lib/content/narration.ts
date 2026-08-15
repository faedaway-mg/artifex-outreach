// ─────────────────────────────────────────────────────────────────────────────
// Narration script — turns a finished Quick Review into spoken narration for a personalized review
// video. It produces (a) internal SEGMENTS with roles (opening / finding-N / close) so scene + caption
// timing can align later, and (b) ONE clean VEED-ready copy block the operator can paste at once.
//
// It is DETERMINISTIC and derived only from the review (same content the PDF shows) — no new analysis,
// no invention. Text is normalized for text-to-speech: symbols spoken out, tracking/URLs removed,
// sentence-final punctuation ensured, blank lines between segments so the voice tool paces naturally.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickReview } from "../outreach/quick-review";

export type SegmentRole = "opening" | "finding" | "close";

export interface NarrationSegment {
  id: string;           // "opening" | "finding-01" | … | "close"
  role: SegmentRole;
  text: string;
  words: number;
}

export interface NarrationScript {
  segments: NarrationSegment[];
  /** One block the operator pastes into the voice tool (segments separated by blank lines). */
  copyBlock: string;
  words: number;
  /** Estimated spoken length at a given words-per-minute (defaults to the measured calibration). */
  estDurationSeconds: (wpm?: number) => number;
}

// MEASURED from a real Lucas voice-over of this exact narration: 151 words / 57.77s ≈ 157 effective wpm
// (Artifex Labs / Urban Americana VO, provided 2026). Supersedes the earlier provisional 143 (macOS
// `say` "Daniel"). Used only for PROVISIONAL preview pacing — the FINAL render is timed to the imported
// audio (audio is the master clock), so this default never governs a voiced cut.
export const CALIBRATION_WPM = 157;
const PAUSE_PER_SEGMENT_SEC = 0.35;

function countWords(s: string): number { return s.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length; }

/** Normalize a sentence for TTS: strip URLs/tracking, speak symbols, tidy whitespace + end punctuation. */
function forSpeech(s: string): string {
  let t = s
    .replace(/https?:\/\/\S+/gi, "")                 // no spoken URLs
    .replace(/\b(\d(?:\.\d)?)\s*★/g, "$1 stars")     // "4.8★" → "4.8 stars"
    .replace(/★/g, " stars")
    .replace(/\s*·\s*/g, ", ")                        // middots read as commas
    .replace(/\s*—\s*/g, " — ")                       // keep em-dash pacing, spaced
    .replace(/\s+/g, " ")
    .trim();
  if (t && !/[.!?…]$/.test(t)) t += ".";
  return t;
}

/** Build the narration from a review. Opening leads with the primary hook; each finding is a beat
 *  (hook + what we found); the close is the "where we'd start" payoff. Concise by design — a review
 *  video is 45–75 seconds, so we speak the hook and the observation, not every supporting clause. */
export function buildNarrationScript(review: QuickReview): NarrationScript {
  const segments: NarrationSegment[] = [];

  const openParts = [review.businessName, review.openingHook].filter(Boolean).map((x) => forSpeech(String(x)));
  segments.push(seg("opening", "opening", openParts.join(" ")));

  review.findings.forEach((f, i) => {
    const hook = review.presentations[i]?.textHook ?? "";
    const text = [hook, f.observation].filter(Boolean).map(forSpeech).join(" ");
    segments.push(seg(`finding-${String(i + 1).padStart(2, "0")}`, "finding", text));
  });

  if (review.start) {
    const close = `Here's where we'd start. ${review.start.label}. ${review.start.why}`;
    segments.push(seg("close", "close", forSpeech(close)));
  }

  const words = segments.reduce((n, s) => n + s.words, 0);
  const copyBlock = segments.map((s) => s.text).join("\n\n");
  return {
    segments,
    copyBlock,
    words,
    estDurationSeconds: (wpm = CALIBRATION_WPM) => round2((words / wpm) * 60 + segments.length * PAUSE_PER_SEGMENT_SEC),
  };
}

function seg(id: string, role: SegmentRole, rawText: string): NarrationSegment {
  const text = rawText.trim();
  return { id, role, text, words: countWords(text) };
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

/** Does the narration fit a target window (e.g. 45/60/75s) at a given rate? Advisory — for the UI to
 *  warn before generation, and for narration-length regression tests. */
export function withinDuration(script: NarrationScript, targetSeconds: number, toleranceSeconds = 8, wpm = CALIBRATION_WPM): boolean {
  return Math.abs(script.estDurationSeconds(wpm) - targetSeconds) <= toleranceSeconds;
}

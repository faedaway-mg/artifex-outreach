// ─────────────────────────────────────────────────────────────────────────────
// Review Video Plan — the canonical story plan the renderer consumes. It does NOT decide business
// intelligence: it is a deterministic projection of the finished Quick Review (findings, hooks,
// evidence, starting point, narration) into an ordered scene list. The renderer never invents findings;
// it only lays out what the plan carries. One scene per narration segment, so captions + audio timing
// align 1:1. Rights default to PRIVATE_ONLY and travel with the plan.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickReview } from "../../outreach/quick-review";
import type { VisualHook } from "../../outreach/review-hooks";
import { buildNarrationScript, type NarrationScript } from "../narration";

// A bounded, deterministic scene vocabulary — variety without randomness. One is chosen per finding
// from its evidence-derived visual hook; the rest are fixed structural scenes.
export type SceneType =
  | "OPENING_HOOK" | "STAT_REVEAL" | "STRUCTURE" | "COMPARISON" | "EVIDENCE_EXCERPT"
  | "SCREENSHOT_FOCUS" | "MOBILE_VIEW" | "TEXT" | "STARTING_POINT" | "CLOSE";

export type RightsState = "PRIVATE_ONLY";

export interface SceneEvidence {
  /** Client-facing source label (e.g. "urbanamericana.com · Catalog & navigation"). */
  sourceLabel: string;
  /** "Directly observed" | "Reported by third parties". */
  confidence: string;
  /** A real screenshot reference when one exists (else null — never faked). */
  screenshotRef: string | null;
}

export interface VideoScene {
  id: string;                 // "opening" | "finding-01" | … | "starting-point" | "close"
  type: SceneType;
  segmentId: string;          // the narration segment this scene speaks over
  /** The big on-screen hook line (sound-off comprehension). */
  headline: string;
  /** Secondary line / observation summary. */
  subline: string | null;
  /** A measured value to feature (STAT/STRUCTURE/COMPARISON), else null. */
  primaryValue: string | null;
  primaryLabel: string | null;
  /** Comparison sides / structure flow, when the scene type uses them. */
  comparison: VisualHook["comparison"];
  structure: string[] | null;
  /** A short real source fragment (EVIDENCE_EXCERPT), else null. */
  excerpt: string | null;
  evidence: SceneEvidence | null;
  narration: string;          // what Lucas says over this scene
  /** Provisional duration (seconds) from narration; rescaled once real audio is imported. */
  provisionalSec: number;
}

export interface ReviewVideoPlan {
  reviewId: string;
  businessId: string;
  businessName: string;
  rightsState: RightsState;
  format: { width: number; height: number; fps: number };
  targetDurationSeconds: number;
  createdAt: string | null;
  openingHook: string | null;
  scenes: VideoScene[];
  narration: NarrationScript;
  /** Enough to later support the private→case-study lifecycle without building it now. */
  provenance: { findingIds: string[]; startingPointFindingId: string | null };
}

const FORMAT = { width: 1080, height: 1920, fps: 24 };

/** Choose the scene type for a finding from its evidence-derived visual hook (deterministic). */
function sceneTypeFor(hook: VisualHook, topic: string): SceneType {
  switch (hook.type) {
    case "STAT": return "STAT_REVEAL";
    case "STRUCTURE": return "STRUCTURE";
    case "COMPARISON": return "COMPARISON";
    case "EXCERPT": return "EVIDENCE_EXCERPT";
    case "SCREENSHOT": return topic === "mobile" ? "MOBILE_VIEW" : "SCREENSHOT_FOCUS";
    default: return "TEXT";
  }
}

function evidenceOf(review: QuickReview, i: number): SceneEvidence {
  const f = review.findings[i];
  return {
    sourceLabel: f.evidence.displayLabel,
    confidence: f.evidence.confidence === "Observed" ? "Directly observed" : "Reported by third parties",
    screenshotRef: f.evidence.screenshotRef,
  };
}

/** Build the story plan from a finished review. Pure. `leadId` identifies the business so an audio
 *  file can never be attached to the wrong lead. targetSeconds shapes provisional pacing only. */
export function buildReviewVideoPlan(review: QuickReview, opts: { reviewId: string; leadId: string; targetSeconds?: number } = { reviewId: "", leadId: "" }): ReviewVideoPlan {
  const target = opts.targetSeconds ?? 60;
  const narration = buildNarrationScript(review);
  const bySeg = Object.fromEntries(narration.segments.map((s) => [s.id, s]));
  const totalWords = narration.words || 1;
  const provisional = (segId: string) => round2((((bySeg[segId]?.words ?? 0) / totalWords) * target) || 0);

  const scenes: VideoScene[] = [];

  // Opening — the strongest curiosity hook + the business, over the opening narration.
  scenes.push({
    id: "opening", type: "OPENING_HOOK", segmentId: "opening",
    headline: review.openingHook ?? review.businessName,
    subline: review.businessName,
    primaryValue: null, primaryLabel: null, comparison: null, structure: null, excerpt: null,
    evidence: review.findings.length ? evidenceOf(review, 0) : null,
    narration: bySeg["opening"]?.text ?? review.businessName,
    provisionalSec: provisional("opening"),
  });

  // One scene per finding, laid out by its evidence-derived visual hook.
  review.findings.forEach((f, i) => {
    const p = review.presentations[i];
    const h = p?.visualHook ?? ({ type: "TEXT_ONLY" } as VisualHook);
    const segId = `finding-${String(i + 1).padStart(2, "0")}`;
    scenes.push({
      id: segId, type: sceneTypeFor(h, f.topic), segmentId: segId,
      headline: p?.textHook ?? f.title,
      subline: f.observation,
      primaryValue: h.primaryValue, primaryLabel: h.supportingLabel,
      comparison: h.comparison, structure: h.structure, excerpt: h.evidenceExcerpt,
      evidence: evidenceOf(review, i),
      narration: bySeg[segId]?.text ?? "",
      provisionalSec: provisional(segId),
    });
  });

  // Starting point — the payoff (only when there is one).
  if (review.start) {
    scenes.push({
      id: "starting-point", type: "STARTING_POINT", segmentId: "close",
      headline: review.start.label, subline: review.start.why,
      primaryValue: null, primaryLabel: null, comparison: null, structure: null, excerpt: null,
      evidence: { sourceLabel: review.start.proofReference, confidence: "Directly observed", screenshotRef: null },
      narration: bySeg["close"]?.text ?? "", provisionalSec: provisional("close"),
    });
  }

  // Close — restrained Artifex identity.
  scenes.push({
    id: "close", type: "CLOSE", segmentId: "close",
    headline: "Artifex Labs", subline: null,
    primaryValue: null, primaryLabel: null, comparison: null, structure: null, excerpt: null,
    evidence: null, narration: "", provisionalSec: 2.2,
  });

  return {
    reviewId: opts.reviewId, businessId: opts.leadId, businessName: review.businessName,
    rightsState: "PRIVATE_ONLY", format: FORMAT, targetDurationSeconds: target, createdAt: null,
    openingHook: review.openingHook, scenes, narration,
    provenance: { findingIds: review.findings.map((f) => f.id), startingPointFindingId: review.start?.sourceFindingId ?? null },
  };
}

// ── Captions (SRT) from narration segments + their scene timings ─────────────────────────────────
export interface SrtCue { index: number; startSec: number; endSec: number; text: string }

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(r).padStart(3, "0")}`;
}
const pad = (n: number) => String(n).padStart(2, "0");

/** Speech captions from segment texts + their timings. Accessibility layer — separate from the
 *  designed on-screen hook typography. Skips empty (e.g. the CLOSE) segments. */
export function buildSrt(segments: Array<{ text: string }>, timings: Array<{ startSec: number; endSec: number }>): string {
  const cues: SrtCue[] = [];
  let idx = 1;
  for (let i = 0; i < segments.length; i++) {
    const text = segments[i]?.text?.trim();
    const t = timings[i];
    if (!text || !t) continue;
    cues.push({ index: idx++, startSec: t.startSec, endSec: t.endSec, text });
  }
  return cues.map((c) => `${c.index}\n${srtTime(c.startSec)} --> ${srtTime(c.endSec)}\n${c.text}\n`).join("\n");
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

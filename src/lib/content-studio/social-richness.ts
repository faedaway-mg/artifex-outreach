// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — SOCIAL "FIELD NOTE" RICHNESS ASSESSORS (mandate §44). PURE.
//
// A Field Note must do VISUAL STORYTELLING, not be "mostly text on the same blue/dark
// background" — a narrated PowerPoint. These are the pure, unit-testable guards that
// BLOCK that failure at two layers:
//
//   1) assessScenePlanRichness(template)  — BEFORE render. The declared scene plan must
//      contain real structural variety: ≥2 DISTINCT structured (non-text) beat kinds and
//      at least some structured beats. A plan that is effectively title/statement/brand
//      text-only is blocked (that is exactly the "text on blue" defect this fixes).
//
//   2) assessRenderedFrameDiversity(samples) — AFTER/DURING render. Given sampled frame
//      descriptors (dominant background key / luma / a scene id per sample), detect the
//      two visible failure modes: (a) a SINGLE background under full-screen text for
//      almost the whole runtime, and (b) long runs of nearly-identical frames. This is a
//      pure function over an array of {sceneId?, bgKey?, sizeBytes?} so the render/QA
//      harness can feed it real samples and it stays testable in isolation.
//
// Neither assessor demands arbitrary visual clutter — a normal Field Note just has to
// contain genuine visual variety. No I/O; no dependency on the renderer. PURE.
// ─────────────────────────────────────────────────────────────────────────────
import type { ContentTemplate } from "./template-schema";

// Beat kinds that carry a real on-screen STRUCTURE (a demonstration), as opposed to the
// three text kinds (title / statement / brand) that are centered narration on the
// background. Kept in sync with zero-touch-template.ts.
export const STRUCTURED_BEAT_KINDS = ["surface", "cards", "chain", "routes", "search", "report", "evidenceShot"] as const;
export const TEXT_BEAT_KINDS = ["title", "statement", "brand"] as const;

export function isStructuredBeatKind(type: string): boolean {
  return (STRUCTURED_BEAT_KINDS as readonly string[]).includes(type);
}

// ── 1) Scene-plan richness (pre-render) ──────────────────────────────────────
export interface ScenePlanRichness {
  ok: boolean;
  /** Count of DISTINCT structured (non-text) beat kinds present. */
  distinctBeatKinds: number;
  /** Total number of structured (non-text) beats. */
  structuredBeatCount: number;
  /** All distinct beat kinds present (structured + text), for reporting. */
  kinds: string[];
  issues: string[];
}

export interface ScenePlanRichnessOptions {
  /** Minimum distinct structured beat kinds required (default 2 — §44). */
  minDistinctStructuredKinds?: number;
  /** Minimum total structured beats required (default 2). */
  minStructuredBeats?: number;
}

/**
 * Assess whether a template's DECLARED scene plan is visually varied enough to be a real
 * Field Note (not text-on-blue). BLOCKS (ok:false) when the plan is effectively text-only:
 * fewer than `minDistinctStructuredKinds` distinct structured kinds, or fewer than
 * `minStructuredBeats` structured beats. PURE — inspects only the template's beats.
 */
export function assessScenePlanRichness(template: Pick<ContentTemplate, "beats">, opts: ScenePlanRichnessOptions = {}): ScenePlanRichness {
  const minDistinct = opts.minDistinctStructuredKinds ?? 2;
  const minStructured = opts.minStructuredBeats ?? 2;

  const beats = Array.isArray(template?.beats) ? template.beats : [];
  const allKinds = new Set<string>();
  const structuredKinds = new Set<string>();
  let structuredBeatCount = 0;
  for (const b of beats) {
    const t = (b as { type?: string })?.type;
    if (!t) continue;
    allKinds.add(t);
    if (isStructuredBeatKind(t)) {
      structuredKinds.add(t);
      structuredBeatCount++;
    }
  }

  const issues: string[] = [];
  if (beats.length === 0) issues.push("Scene plan has no beats.");
  if (structuredBeatCount < minStructured) {
    issues.push(
      `Scene plan is effectively text-only: ${structuredBeatCount} structured (non-text) beat(s), needs ≥${minStructured}. A Field Note must DEMONSTRATE the idea, not narrate text on one background.`,
    );
  }
  if (structuredKinds.size < minDistinct) {
    issues.push(
      `Only ${structuredKinds.size} distinct structured beat kind(s) (needs ≥${minDistinct}) — not enough visual variety. Present: [${[...structuredKinds].join(", ") || "none"}].`,
    );
  }

  return {
    ok: issues.length === 0,
    distinctBeatKinds: structuredKinds.size,
    structuredBeatCount,
    kinds: [...allKinds],
    issues,
  };
}

// ── 2) Rendered frame diversity (post/during render) ─────────────────────────
// A minimal, harness-friendly frame descriptor. The QA/render sampler produces one of
// these per sampled frame; none of the fields are required so partial samplers still work.
export interface FrameSample {
  /** The scene/beat id (or index) this frame belongs to — used to detect too-few scenes. */
  sceneId?: string | number;
  /** A coarse key for the dominant background (e.g. "blue-dark", or a luma bucket). */
  bgKey?: string;
  /** Approximate perceptual luma 0..1 of the frame (an alternative background signal). */
  luma?: number;
  /** Encoded size in bytes — near-identical frames encode to near-identical sizes. */
  sizeBytes?: number;
}

export interface FrameDiversity {
  ok: boolean;
  /** Number of distinct background keys observed across the runtime. */
  distinctBackgrounds: number;
  /** Number of distinct scene ids observed. */
  distinctScenes: number;
  /** Fraction (0..1) of the run that is the single most common background. */
  dominantBackgroundShare: number;
  /** Longest run of consecutive nearly-identical frames, as a fraction of the run. */
  longestIdenticalRunShare: number;
  issues: string[];
}

export interface FrameDiversityOptions {
  /** Block when the single most-common background covers ≥ this share of the run (default 0.9). */
  maxDominantBackgroundShare?: number;
  /** Block when a run of nearly-identical frames covers ≥ this share of the run (default 0.6). */
  maxIdenticalRunShare?: number;
  /** Require at least this many distinct scenes (default 2). */
  minDistinctScenes?: number;
  /** Relative size delta under which two consecutive frames count as "nearly identical" (default 0.02 = 2%). */
  identicalSizeTolerance?: number;
  /** Luma delta under which two consecutive frames count as "nearly identical" (default 0.02). */
  identicalLumaTolerance?: number;
}

/**
 * Detect the two visible "narrated PowerPoint" failures from sampled frame descriptors:
 *   • a SINGLE background under full-screen text for almost the entire runtime, and
 *   • long runs of nearly-identical frames (nothing moving / one static card held).
 * PURE over the sample array; tolerant of partial samplers (missing fields are skipped).
 * Returns ok:false with human-readable issues when a failure is detected.
 */
export function assessRenderedFrameDiversity(samples: FrameSample[], opts: FrameDiversityOptions = {}): FrameDiversity {
  const maxDominantBg = opts.maxDominantBackgroundShare ?? 0.9;
  const maxIdenticalRun = opts.maxIdenticalRunShare ?? 0.6;
  const minScenes = opts.minDistinctScenes ?? 2;
  const sizeTol = opts.identicalSizeTolerance ?? 0.02;
  const lumaTol = opts.identicalLumaTolerance ?? 0.02;

  const list = Array.isArray(samples) ? samples : [];
  const issues: string[] = [];
  if (list.length === 0) {
    return { ok: false, distinctBackgrounds: 0, distinctScenes: 0, dominantBackgroundShare: 0, longestIdenticalRunShare: 0, issues: ["No frame samples provided."] };
  }

  // Background distribution: prefer explicit bgKey; fall back to a coarse luma bucket.
  const bgKeyOf = (s: FrameSample): string | null => {
    if (s.bgKey != null) return String(s.bgKey);
    if (typeof s.luma === "number") return `luma:${Math.round(s.luma * 20) / 20}`; // 0.05 buckets
    return null;
  };
  const bgCounts = new Map<string, number>();
  let bgSampled = 0;
  for (const s of list) {
    const k = bgKeyOf(s);
    if (k == null) continue;
    bgCounts.set(k, (bgCounts.get(k) ?? 0) + 1);
    bgSampled++;
  }
  const distinctBackgrounds = bgCounts.size;
  const dominantBackgroundShare = bgSampled > 0 ? Math.max(...bgCounts.values()) / bgSampled : 0;

  // Scene distribution.
  const scenes = new Set<string>();
  for (const s of list) if (s.sceneId != null) scenes.add(String(s.sceneId));
  const distinctScenes = scenes.size;

  // Longest run of consecutive nearly-identical frames (by size and/or luma).
  const nearlyIdentical = (a: FrameSample, b: FrameSample): boolean => {
    let comparable = false;
    if (typeof a.sizeBytes === "number" && typeof b.sizeBytes === "number") {
      comparable = true;
      const denom = Math.max(1, a.sizeBytes, b.sizeBytes);
      if (Math.abs(a.sizeBytes - b.sizeBytes) / denom > sizeTol) return false;
    }
    if (typeof a.luma === "number" && typeof b.luma === "number") {
      comparable = true;
      if (Math.abs(a.luma - b.luma) > lumaTol) return false;
    }
    // Different explicit backgrounds are never "identical".
    if (a.bgKey != null && b.bgKey != null && a.bgKey !== b.bgKey) return false;
    return comparable;
  };
  let longestRun = 1;
  let run = 1;
  for (let i = 1; i < list.length; i++) {
    if (nearlyIdentical(list[i - 1], list[i])) {
      run++;
      if (run > longestRun) longestRun = run;
    } else {
      run = 1;
    }
  }
  const longestIdenticalRunShare = list.length > 0 ? longestRun / list.length : 0;

  // Failure modes.
  if (bgSampled > 0 && dominantBackgroundShare >= maxDominantBg && distinctBackgrounds <= 1) {
    issues.push(
      `Single background for ${(dominantBackgroundShare * 100).toFixed(0)}% of the runtime — this is "text on one blue background" (a narrated PowerPoint), not visual storytelling.`,
    );
  } else if (bgSampled > 0 && dominantBackgroundShare >= maxDominantBg) {
    issues.push(
      `One background covers ${(dominantBackgroundShare * 100).toFixed(0)}% of the runtime (≥${(maxDominantBg * 100).toFixed(0)}%) — too little visual variety.`,
    );
  }
  if (longestIdenticalRunShare >= maxIdenticalRun) {
    issues.push(
      `A near-identical frame is held for ${(longestIdenticalRunShare * 100).toFixed(0)}% of the runtime (≥${(maxIdenticalRun * 100).toFixed(0)}%) — the video barely changes; nothing is being shown.`,
    );
  }
  if (distinctScenes > 0 && distinctScenes < minScenes) {
    issues.push(`Only ${distinctScenes} distinct scene(s) across the runtime (needs ≥${minScenes}).`);
  }

  return { ok: issues.length === 0, distinctBackgrounds, distinctScenes, dominantBackgroundShare, longestIdenticalRunShare, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence framing (M2.1) — purpose-aware geometry so a business surface is never ACCIDENTALLY clipped.
// A surface plays one of three roles, and geometry follows the role:
//   • EVIDENCE_FRAME — the surface is PROOF: show the relevant region in full context (fit, safe margin,
//     no initial crop), then push toward the focal detail LATER (context → focus).
//   • CINEMATIC_CROP — the surface is atmosphere/B-roll/transition: aggressive cover/Ken-Burns is fine.
//   • FOCUS_CROP     — begin already zoomed on a focal detail (only when context is already established).
// Governing rule: context first, focus second; never clip meaningful evidence at frame boundaries.
//
// Pure + deterministic. Rects are NORMALIZED (0..1) so they survive any surface size/aspect.
// ─────────────────────────────────────────────────────────────────────────────
export type FramingMode = "EVIDENCE_FRAME" | "CINEMATIC_CROP" | "FOCUS_CROP";

export interface Rect { x: number; y: number; width: number; height: number }
export const FULL: Rect = { x: 0, y: 0, width: 1, height: 1 };

export function clampRect(r: Rect, bounds: Rect = FULL): Rect {
  const w = Math.min(bounds.width, Math.max(0.02, r.width));
  const h = Math.min(bounds.height, Math.max(0.02, r.height));
  const x = Math.min(bounds.x + bounds.width - w, Math.max(bounds.x, r.x));
  const y = Math.min(bounds.y + bounds.height - h, Math.max(bounds.y, r.y));
  return { x, y, width: w, height: h };
}

/** Expand a rect by proportional margins on each side (a safe contextual margin), clamped to [0,1]. */
export function expandRect(r: Rect, mx: number, my: number): Rect {
  return clampRect({ x: r.x - mx, y: r.y - my, width: r.width + 2 * mx, height: r.height + 2 * my });
}

export function centerOf(r: Rect): { cx: number; cy: number } { return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }

/** The instructions the renderer applies to a surface for a scene. `scaleStart` is the scale at scene
 *  start; `scaleEnd` at scene end; `focusStart` is the fraction of the scene (0..1) at which the push
 *  toward the focal point begins. originX/Y (0..1) is the transform origin = where we zoom toward. */
export interface SurfaceFraming {
  mode: FramingMode;
  scaleStart: number;
  scaleEnd: number;
  focusStart: number;     // 0..1 of scene local time
  originX: number;        // 0..1
  originY: number;        // 0..1
  contextMargin: number;  // the margin that was applied to the evidence bounds
  /** True when the whole (margin-expanded) evidence region is guaranteed visible at scaleStart. */
  contextPreserved: boolean;
}

/** Plan a surface's framing from its role. For EVIDENCE_FRAME it GUARANTEES the safe evidence region is
 *  fully visible at the start (scaleStart ≤ 1 with a contain fit), then pushes toward the focal center;
 *  a cover surface (fit=false) can crop. `focal` and `evidenceBounds` are normalized; margin ~0.05–0.08. */
export function planFraming(
  mode: FramingMode,
  focal: Rect | null,
  evidenceBounds: Rect | null,
  margin = 0.06,
  focusZoom = 0.16,
): SurfaceFraming {
  const f = focal ? clampRect(focal) : FULL;
  const { cx, cy } = centerOf(f);
  if (mode === "CINEMATIC_CROP") {
    // Atmospheric cover: a gentle Ken-Burns push the whole scene; light edge bleed is acceptable here.
    return { mode, scaleStart: 1.03, scaleEnd: 1.08, focusStart: 0, originX: 0.5, originY: focal ? cy : 0.14, contextMargin: 0, contextPreserved: false };
  }
  if (mode === "FOCUS_CROP") {
    // Begin already zoomed on the focal detail (context assumed established by a prior shot).
    return { mode, scaleStart: 1.12, scaleEnd: 1.2, focusStart: 0, originX: cx, originY: cy, contextMargin: 0, contextPreserved: false };
  }
  // EVIDENCE_FRAME — the safe region (evidence + margin) must be fully visible at the start.
  const safe = expandRect(evidenceBounds ?? FULL, margin, margin);
  // With a contain fit the whole surface shows at scale 1.0, so any sub-region (incl. safe) is visible.
  // The focus push zooms toward the focal center AFTER context, so meaningful edges are never clipped early.
  return {
    mode, scaleStart: 1.0, scaleEnd: 1.0 + focusZoom, focusStart: 0.55,
    originX: cx, originY: cy, contextMargin: margin,
    contextPreserved: safe.width <= 1 && safe.height <= 1, // fits by construction
  };
}

/** The scale to apply at scene-local progress p∈[0,1] for a framing (eased focus push). Pure — mirrors
 *  what the HTML renderer computes, so timing/no-clip behavior is unit-testable without a browser. */
export function scaleAt(fr: SurfaceFraming, p: number, easeOut = (x: number) => 1 - Math.pow(1 - x, 3)): number {
  const q = Math.min(1, Math.max(0, p));
  if (fr.mode === "EVIDENCE_FRAME") {
    if (q <= fr.focusStart) return fr.scaleStart;                  // full context, no crop
    const u = (q - fr.focusStart) / (1 - fr.focusStart || 1e-6);
    return fr.scaleStart + (fr.scaleEnd - fr.scaleStart) * easeOut(u);
  }
  return fr.scaleStart + (fr.scaleEnd - fr.scaleStart) * easeOut(q);
}

/** Would a naive center-COVER of `source` into `target` clip the evidence region? Used to justify the
 *  EVIDENCE_FRAME fit choice (and to test the exact catalog-clip failure shape). Pure. */
export function centerCoverClips(srcW: number, srcH: number, tgtW: number, tgtH: number, evidence: Rect): boolean {
  const scale = Math.max(tgtW / srcW, tgtH / srcH);       // cover
  const dispW = srcW * scale, dispH = srcH * scale;
  const offX = (tgtW - dispW) / 2, offY = (tgtH - dispH) / 2; // centered
  // Evidence rect in displayed (target) pixels:
  const ex0 = offX + evidence.x * dispW, ex1 = offX + (evidence.x + evidence.width) * dispW;
  const ey0 = offY + evidence.y * dispH, ey1 = offY + (evidence.y + evidence.height) * dispH;
  return ex0 < -0.5 || ey0 < -0.5 || ex1 > tgtW + 0.5 || ey1 > tgtH + 0.5;
}

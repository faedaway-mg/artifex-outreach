// ─────────────────────────────────────────────────────────────────────────────
// Capture guard — PURE, offline-testable protection against the "white strip at
// the bottom" defect (Quick Review video, Gate 6).
//
// A captured surface is placed into the vertical 1080×1920 frame. In EVIDENCE_FRAME
// treatment the surface is fit to the frame WIDTH and anchored at the top, so when
// the page content is SHORTER than the frame it renders too short and leaves an
// unfilled band at the bottom. This module computes, from the captured PNG
// dimensions alone, whether that band would appear — so the renderer can drop the
// surface to an atmospheric treatment (which always covers) or mark CAPTURE_BLOCKED
// and refuse to emit a broken video, exactly as the mission requires.
//
// No I/O. No dependencies. Fully deterministic.
// ─────────────────────────────────────────────────────────────────────────────

export interface Dimensions {
  width: number;
  height: number;
}

export type CaptureRecommendation =
  | "use-as-evidence"   // fills the evidence area — safe to use fit-to-width
  | "atmospheric-only"  // minor shortfall — cover the frame (crop) instead of fit; no band
  | "capture-blocked";  // too short to cover cleanly — do NOT emit; mark CAPTURE_BLOCKED

export interface CaptureAssessment {
  /** Fraction of the evidence area's height the surface fills when fit to width (0..1). */
  coverage: number;
  /** True when the fit-to-width surface fully fills the evidence area (no bottom band). */
  coversBottom: boolean;
  /** Height in device px of the unfilled bottom band (0 when it fully covers). */
  bottomBandPx: number;
  recommendation: CaptureRecommendation;
  reason: string;
}

export interface CaptureGuardOptions {
  /** Output frame, defaults to the vertical 1080×1920 Quick Review frame. */
  frame?: Dimensions;
  /** Vertical fraction of the frame used for evidence (matches EVIDENCE_BOUNDS.height). */
  evidenceHeightFraction?: number;
  /**
   * Below this coverage the surface can still cover the frame via a center-crop
   * (atmospheric treatment) without a band. At/above it, fit-to-width is safe.
   */
  atmosphericFloor?: number;
  /**
   * Below this coverage even a crop would over-zoom into an unreadable sliver, so
   * the capture is unusable — mark CAPTURE_BLOCKED rather than ship something broken.
   */
  blockFloor?: number;
}

const DEFAULT_FRAME: Dimensions = { width: 1080, height: 1920 };

/**
 * Assess a captured surface against the frame it will fill. `surface` is the PNG's
 * pixel dimensions AFTER trim (what `magick identify` reports). Pure.
 */
export function assessCapture(surface: Dimensions, opts: CaptureGuardOptions = {}): CaptureAssessment {
  const frame = opts.frame ?? DEFAULT_FRAME;
  const evFraction = opts.evidenceHeightFraction ?? 0.95;
  const atmosphericFloor = opts.atmosphericFloor ?? 0.85;
  const blockFloor = opts.blockFloor ?? 0.5;

  const evidenceHeight = frame.height * evFraction;

  if (!(surface.width > 0) || !(surface.height > 0)) {
    return {
      coverage: 0,
      coversBottom: false,
      bottomBandPx: Math.round(evidenceHeight),
      recommendation: "capture-blocked",
      reason: "capture has no measurable dimensions",
    };
  }

  // Fit the surface to the frame width; its rendered height is the aspect-scaled height.
  const renderedHeight = frame.width * (surface.height / surface.width);
  const coverage = Math.min(1, renderedHeight / evidenceHeight);
  const bottomBandPx = Math.max(0, Math.round(evidenceHeight - renderedHeight));
  const coversBottom = renderedHeight >= evidenceHeight;

  if (coversBottom) {
    return { coverage: 1, coversBottom: true, bottomBandPx: 0, recommendation: "use-as-evidence", reason: "surface fills the evidence area when fit to width" };
  }
  if (coverage >= atmosphericFloor) {
    return { coverage, coversBottom: false, bottomBandPx, recommendation: "atmospheric-only", reason: `surface is ${(coverage * 100).toFixed(0)}% of the evidence height — cover-crop instead of fit-to-width to avoid a ${bottomBandPx}px band` };
  }
  if (coverage >= blockFloor) {
    return { coverage, coversBottom: false, bottomBandPx, recommendation: "atmospheric-only", reason: `surface is short (${(coverage * 100).toFixed(0)}%) — usable only as a cover-cropped background` };
  }
  return { coverage, coversBottom: false, bottomBandPx, recommendation: "capture-blocked", reason: `surface is far too short (${(coverage * 100).toFixed(0)}% of evidence height) to fill the frame cleanly — mark CAPTURE_BLOCKED` };
}

/** Convenience: true when using this capture fit-to-width would leave a visible bottom band. */
export function wouldLeaveBottomBand(surface: Dimensions, opts: CaptureGuardOptions = {}): boolean {
  return !assessCapture(surface, opts).coversBottom;
}

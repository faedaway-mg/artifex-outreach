// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — RENDERED-BROWSER VISUAL QA (Mandate Parts Q/R/S/T/U/V).
//
// PURE assertion logic over element geometry. There is NO browser, NO DOM, and NO
// I/O in this file. It receives a plain `RenderedSurface` snapshot (the geometry a
// harness already extracted from a real rendered page) and decides PASS / BLOCKED.
// This separation is deliberate:
//   • the browser harness (scripts/breakbot-visual.ts) owns Playwright/Chromium and
//     is the ONLY thing that launches a browser or writes files;
//   • this module is a deterministic pure function → unit-testable in vitest with
//     synthetic geometry, no browser, milliseconds fast.
//
// FAIL-CLOSED (Part V). Visual QA NEVER approves, sends, charges, or mutates state.
// It READS geometry and REPORTS. A BLOCKER is the ONLY thing that prevents PASS.
// WARNING never blocks. Every finding names the surface/element, what was EXPECTED
// and what was OBSERVED.
//
// TOLERANCE / BASELINE POLICY (Part S).
//   • Geometry checks use a ~2px tolerance so antialiasing / sub-pixel rounding /
//     a single-pixel difference NEVER fails a surface. Real breakage (a 2000px
//     element on a 390px viewport, a zero-height CTA, an overlapping sticky bar) is
//     orders of magnitude larger than the tolerance and is caught deterministically.
//   • These geometry assertions need NO pixel-diff baseline. Screenshots are captured
//     as *evidence*, not as a golden to diff against, precisely so that a harmless
//     re-render can't flake the gate.
//   • If a future check DOES diff against a stored baseline, that baseline is only
//     valid for a stable fixture and must NEVER be auto-rewritten to make a failing
//     test go green — a regression that "updates the baseline" hides the regression.
//     Baselines are updated by a human, on purpose, with review.
// ─────────────────────────────────────────────────────────────────────────────

export type VisualViewport = "mobile" | "desktop";

export const VIEWPORTS: Record<VisualViewport, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
};

export type VisualStatus = "PASS" | "BLOCKED" | "NOT_RUN";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  zIndex?: number;
}

export interface RenderedSurface {
  surface: string;
  viewport: VisualViewport;
  documentScrollWidth: number;
  viewportWidth: number;
  elements: Record<string, Box | null>;
  screenshotPath?: string | null;
}

export interface VisualFinding {
  kind: string;
  severity: "BLOCKER" | "WARNING";
  detail: string;
  element?: string;
}

export interface VisualQaResult {
  surface: string;
  viewport: VisualViewport;
  status: VisualStatus;
  findings: VisualFinding[];
  screenshotPath: string | null;
}

// ~2px tolerance — antialiasing / sub-pixel rounding must never trip the gate.
export const GEOMETRY_TOLERANCE_PX = 2;

// A screenshot narrower than this is too small to be a real evidence capture.
const MIN_EVIDENCE_SCREENSHOT_WIDTH = 160;

// An evidence screenshot whose aspect ratio is this far from any sane bound is distorted.
const MAX_EVIDENCE_ASPECT = 6; // wider than 6:1 or taller than 1:6 => distorted

function isRenderedVisible(b: Box | null | undefined): b is Box {
  return !!b && b.visible === true && b.width > 0 && b.height > 0;
}

// Do two boxes overlap on the vertical axis (with tolerance so a 1px touch is fine)?
function verticallyOverlap(a: Box, b: Box, tolerance: number): boolean {
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;
  // Overlap amount on the shared vertical span; > tolerance means a real overlap.
  const overlap = Math.min(aBottom, bBottom) - Math.max(a.y, b.y);
  return overlap > tolerance;
}

/**
 * Assess a single rendered surface at a single viewport.
 *
 * Deterministic Part-S assertions, geometry only:
 *   1. horizontal overflow          — documentScrollWidth > viewportWidth + 2px
 *   2. clipped/hidden primary CTA    — primaryCta missing / !visible / height<=0
 *   3. hidden operator website button— websiteButton present-but-!visible
 *   4. sticky bar overlaps purchase  — vertical overlap AND stickyBar.z >= purchase.z
 *   5. duplicate sticky bar          — stickyBar2 present & visible
 *   6. evidence screenshot too small — width < 160 or aspect wildly off
 *   7. missing video frame/poster    — personalizedVideoFrame missing / !visible
 *   8. price leaking into hero       — heroPrice present & visible (when forbidden)
 *   9. primary text clipped          — heroTitle width<=0 or height<=0
 *
 * PASS iff zero BLOCKER findings.
 */
export function assessRenderedSurface(s: RenderedSurface): VisualQaResult {
  const findings: VisualFinding[] = [];
  const el = s.elements ?? {};
  const T = GEOMETRY_TOLERANCE_PX;

  // 1) Horizontal overflow — the page scrolls sideways at this viewport.
  if (s.documentScrollWidth > s.viewportWidth + T) {
    findings.push({
      kind: "overflow",
      severity: "BLOCKER",
      detail: `horizontal overflow: documentScrollWidth ${s.documentScrollWidth}px exceeds viewport ${s.viewportWidth}px (tolerance ${T}px)`,
    });
  }

  // 2) Clipped / hidden primary CTA.
  const cta = el["primaryCta"];
  if (!cta || !cta.visible || cta.height <= 0) {
    findings.push({
      kind: "cta.hidden",
      severity: "BLOCKER",
      element: "primaryCta",
      detail: !cta
        ? "primary CTA element is missing"
        : `primary CTA is not usable (visible=${cta.visible}, height=${cta.height}px)`,
    });
  }

  // 3) Operator open-site / website button present in DOM but not visible.
  //    (Present-but-hidden is a defect; genuinely absent is not asserted here — a
  //     surface without an operator button is a different surface.)
  const websiteButton = el["websiteButton"];
  if (websiteButton && !websiteButton.visible) {
    findings.push({
      kind: "operator.websiteButton.hidden",
      severity: "BLOCKER",
      element: "websiteButton",
      detail: "operator website/open-site button is present but not visible",
    });
  }

  // 4) Sticky bar overlapping the terms/purchase controls (and painted on top).
  const stickyBar = el["stickyBar"];
  const purchase = el["purchaseControls"];
  if (isRenderedVisible(stickyBar) && isRenderedVisible(purchase)) {
    const stickyZ = stickyBar.zIndex ?? 0;
    const purchaseZ = purchase.zIndex ?? 0;
    if (verticallyOverlap(stickyBar, purchase, T) && stickyZ >= purchaseZ) {
      findings.push({
        kind: "sticky.overlap",
        severity: "BLOCKER",
        element: "stickyBar",
        detail: `sticky bar overlaps purchase controls and is painted on top (stickyZ ${stickyZ} >= purchaseZ ${purchaseZ})`,
      });
    }
  }

  // 5) Duplicate sticky bar.
  const stickyBar2 = el["stickyBar2"];
  if (isRenderedVisible(stickyBar2)) {
    findings.push({
      kind: "sticky.duplicate",
      severity: "BLOCKER",
      element: "stickyBar2",
      detail: "a second sticky bar is rendered and visible (duplicate sticky bar)",
    });
  }

  // 6) Evidence screenshot too small / distorted.
  const shot = el["evidenceScreenshot"];
  if (shot && shot.visible) {
    if (shot.width < MIN_EVIDENCE_SCREENSHOT_WIDTH) {
      findings.push({
        kind: "evidence.tooSmall",
        severity: "BLOCKER",
        element: "evidenceScreenshot",
        detail: `evidence screenshot is too small (width ${shot.width}px < ${MIN_EVIDENCE_SCREENSHOT_WIDTH}px)`,
      });
    } else if (shot.height > 0) {
      const aspect = shot.width / shot.height;
      if (aspect > MAX_EVIDENCE_ASPECT || aspect < 1 / MAX_EVIDENCE_ASPECT) {
        findings.push({
          kind: "evidence.distorted",
          severity: "BLOCKER",
          element: "evidenceScreenshot",
          detail: `evidence screenshot aspect ratio is distorted (${shot.width}x${shot.height} => ${aspect.toFixed(2)}:1)`,
        });
      }
    }
  }

  // 7) Missing personalized video frame / poster.
  const video = el["personalizedVideoFrame"];
  const videoDetail = video
    ? `personalized video frame/poster is not visible (visible=${video.visible}, ${video.width}x${video.height})`
    : "personalized video frame/poster element is missing";
  if (!isRenderedVisible(video)) {
    findings.push({
      kind: "video.frameMissing",
      severity: "BLOCKER",
      element: "personalizedVideoFrame",
      detail: videoDetail,
    });
  }

  // 8) Price leaking into the hero when forbidden.
  const heroPrice = el["heroPrice"];
  if (isRenderedVisible(heroPrice)) {
    findings.push({
      kind: "price.inHero",
      severity: "BLOCKER",
      element: "heroPrice",
      detail: "a price is visible in the hero where price is forbidden",
    });
  }

  // 9) Primary hero text clipped to nothing.
  const heroTitle = el["heroTitle"];
  if (heroTitle && (heroTitle.height <= 0 || heroTitle.width <= 0)) {
    findings.push({
      kind: "heroTitle.clipped",
      severity: "BLOCKER",
      element: "heroTitle",
      detail: `hero title is clipped to zero size (${heroTitle.width}x${heroTitle.height})`,
    });
  }

  const hasBlocker = findings.some((f) => f.severity === "BLOCKER");
  return {
    surface: s.surface,
    viewport: s.viewport,
    status: hasBlocker ? "BLOCKED" : "PASS",
    findings,
    screenshotPath: s.screenshotPath ?? null,
  };
}

/**
 * Combine per-surface results into a single portfolio verdict.
 * NOT_RUN when there is nothing to assess. Otherwise BLOCKED if ANY surface is
 * BLOCKED, else PASS. Fail-closed: one blocked golden blocks the whole run.
 */
export function combineVisualResults(results: VisualQaResult[]): {
  status: VisualStatus;
  blocked: VisualQaResult[];
} {
  if (results.length === 0) return { status: "NOT_RUN", blocked: [] };
  const blocked = results.filter((r) => r.status === "BLOCKED");
  return { status: blocked.length > 0 ? "BLOCKED" : "PASS", blocked };
}

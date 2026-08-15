// ─────────────────────────────────────────────────────────────────────────────
// Evidence assets (M1.1) — the real prospect surfaces the video is built ON. An EvidenceAsset ties a
// captured business surface (a desktop/mobile screenshot of the pages we analyzed) to the exact
// review/business/finding it came from, so a capture can never bleed across leads or attach to the
// wrong finding. The renderer prefers a real surface over an abstract Artifex scene when one exists;
// when none does, it falls back honestly (never fabricates a screenshot).
//
// Association + focal math are PURE here; the capture itself (Chrome headless of the analyzed HTML) is
// done in the render script. Rights default PRIVATE_ONLY and travel with every asset.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReviewVideoPlan, VideoScene } from "./plan";

/** A region of interest inside a surface, NORMALIZED 0..1, so it survives any resize. */
export interface FocalRegion { x: number; y: number; width: number; height: number }

export type EvidenceAssetType = "desktop-capture" | "mobile-capture" | "evidence-image";

export interface EvidenceAsset {
  assetId: string;
  reviewId: string;
  businessId: string;
  /** The finding this surface illustrates (null = a general business surface, e.g. the opening). */
  findingId: string | null;
  type: EvidenceAssetType;
  sourceUrl: string | null;
  localPath: string;
  dimensions: { width: number; height: number };
  /** Where to look inside the surface (null = whole surface). */
  focalRegion: FocalRegion | null;
  rightsState: "PRIVATE_ONLY";
  provenance: string;
}

/** Clamp a focal region into the frame and guarantee a non-degenerate box. Pure. */
export function clampFocal(r: FocalRegion | null): FocalRegion {
  if (!r) return { x: 0, y: 0, width: 1, height: 1 };
  const w = Math.min(1, Math.max(0.05, r.width));
  const h = Math.min(1, Math.max(0.05, r.height));
  const x = Math.min(1 - w, Math.max(0, r.x));
  const y = Math.min(1 - h, Math.max(0, r.y));
  return { x, y, width: w, height: h };
}

/** The center of a (clamped) focal region as fractions — what motion pushes toward. Pure. */
export function focalCenter(r: FocalRegion | null): { cx: number; cy: number } {
  const c = clampFocal(r);
  return { cx: c.x + c.width / 2, cy: c.y + c.height / 2 };
}

/** Which surface backs a scene (deterministic). Preference: an asset explicitly for this finding →
 *  a topic-appropriate capture (mobile scenes want the mobile capture; site/catalog want desktop) →
 *  none. NEVER returns an asset from another business (cross-lead guard). */
export function selectSceneSurface(scene: VideoScene, findingId: string | null, businessId: string, assets: EvidenceAsset[]): EvidenceAsset | null {
  const safe = assets.filter((a) => a.businessId === businessId);
  // 1) exact finding match
  if (findingId) {
    const exact = safe.find((a) => a.findingId === findingId);
    if (exact) return exact;
  }
  // 2) topic/scene-type appropriate capture
  const wantMobile = scene.type === "MOBILE_VIEW" || scene.type === "SCREENSHOT_FOCUS";
  const wantSite = scene.type === "OPENING_HOOK" || scene.type === "STRUCTURE" || scene.type === "COMPARISON";
  if (wantMobile) { const m = safe.find((a) => a.type === "mobile-capture"); if (m) return m; }
  if (wantSite) { const d = safe.find((a) => a.type === "desktop-capture"); if (d) return d; }
  return null;
}

/** Does a scene end up backed by a real surface? Used for the coverage metric + composition choice. */
export function sceneHasSurface(scene: VideoScene, findingId: string | null, businessId: string, assets: EvidenceAsset[]): boolean {
  return !!selectSceneSurface(scene, findingId, businessId, assets);
}

/** Business-surface coverage: share of runtime whose scenes are backed by real prospect surfaces.
 *  Honest measurement for QA — NOT a production gate. Pure. */
export function businessSurfaceCoverage(
  plan: ReviewVideoPlan, durations: number[], assets: EvidenceAsset[],
): { businessSeconds: number; totalSeconds: number; fraction: number } {
  let biz = 0, total = 0;
  plan.scenes.forEach((s, i) => {
    const d = durations[i] ?? 0; total += d;
    const findingId = s.id.startsWith("finding-") ? plan.provenance.findingIds[Number(s.id.slice(-2)) - 1] ?? null : null;
    if (sceneHasSurface(s, findingId, plan.businessId, assets)) biz += d;
  });
  return { businessSeconds: round2(biz), totalSeconds: round2(total), fraction: total ? round2(biz / total) : 0 };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

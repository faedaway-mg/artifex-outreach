// ─────────────────────────────────────────────────────────────────────────────
// Page plan (M2) — the JSON the review-scene.html renderer consumes. It projects the canonical
// ReviewVideoPlan into content-grade scene data: two-line editorial hooks (second line accented like
// the content videos), the measured value/comparison to feature, the starting-point payoff, and the
// real business surface + its focal point for each scene. Pure + deterministic; invents nothing.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReviewVideoPlan, VideoScene } from "./plan";
import type { QuickReview } from "../../outreach/quick-review";
import type { SceneWindow } from "./motion";

export interface PageSurface {
  src: string;
  kind: "desktop" | "mobile";
  focalY: number;
  /** Purpose-aware framing (M2.1): mode + the eased focus-push params the renderer applies so evidence
   *  is never clipped early. Computed from the surface's role via framing.planFraming(). */
  mode: import("./framing").FramingMode;
  scaleStart: number;
  scaleEnd: number;
  focusStart: number;
  originX: number;
  originY: number;
}
export interface PageScene {
  id: string;
  type: VideoScene["type"];
  start: number;
  end: number;
  businessName?: string;
  hook?: { l1: string; l2: string };
  value?: string | null;
  label?: string | null;
  cmp?: { left: string; leftLabel: string; right: string; rightLabel: string } | null;
  why?: string | null;
  proof?: string | null;
  surface?: PageSurface | null;
}
export interface PagePlan { masthead: string; businessName: string; total: number; scenes: PageScene[] }

/** Split a hook into a two-line editorial statement: line 1 sets the tension, line 2 (accented) lands
 *  it. Splits on the first sentence break; falls back to a single line. Pure. */
export function splitHook(hook: string): { l1: string; l2: string } {
  const h = (hook || "").trim();
  const m = h.match(/^(.+?[.!?])\s+(.*)$/);
  if (m && m[2]) return { l1: m[1].trim(), l2: m[2].trim() };
  // No sentence break — split near the middle on a word boundary if it's long, else one line.
  if (h.length > 42) {
    const mid = h.lastIndexOf(" ", Math.ceil(h.length / 2));
    if (mid > 0) return { l1: h.slice(0, mid).trim(), l2: h.slice(mid).trim() };
  }
  return { l1: h, l2: "" };
}

/** Build the content-grade page plan. `surfaces` maps a scene id → its real captured surface (or is
 *  absent → no surface, honest fallback). `schedule` supplies each scene's absolute time window. */
export function buildScenePlan(
  review: QuickReview,
  plan: ReviewVideoPlan,
  schedule: SceneWindow[],
  surfaces: Record<string, PageSurface>,
): PagePlan {
  const win = Object.fromEntries(schedule.map((w) => [w.id, w]));
  const scenes: PageScene[] = plan.scenes.map((s) => {
    const w = win[s.id] ?? { startSec: 0, endSec: 2 };
    const base: PageScene = { id: s.id, type: s.type, start: w.startSec, end: w.endSec, surface: surfaces[s.id] ?? null };
    switch (s.type) {
      case "OPENING_HOOK":
        return { ...base, businessName: review.businessName, hook: splitHook(s.headline) };
      case "STRUCTURE": case "STAT_REVEAL":
        return { ...base, value: s.primaryValue, label: (s.primaryLabel ?? "").toUpperCase(), hook: splitHook(s.headline) };
      case "COMPARISON":
        return { ...base, cmp: s.comparison ? { left: s.comparison.left, leftLabel: s.comparison.leftLabel.toUpperCase(), right: s.comparison.right, rightLabel: s.comparison.rightLabel.toUpperCase() } : null, hook: splitHook(s.headline) };
      case "STARTING_POINT":
        return { ...base, label: s.headline, why: s.subline, proof: s.evidence ? `Proof · ${s.evidence.sourceLabel}` : null };
      case "CLOSE":
        return base;
      default: // TEXT (e.g. mobile)
        return { ...base, hook: splitHook(s.headline) };
    }
  });
  return { masthead: "ARTIFEX / QUICK REVIEW", businessName: review.businessName, total: schedule.length ? schedule[schedule.length - 1].endSec : 0, scenes };
}

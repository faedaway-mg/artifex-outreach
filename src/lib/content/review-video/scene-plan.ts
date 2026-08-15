// ─────────────────────────────────────────────────────────────────────────────
// Page plan (M2) — the JSON the review-scene.html renderer consumes. It projects the canonical
// ReviewVideoPlan into content-grade scene data: two-line editorial hooks (second line accented like
// the content videos), the measured value/comparison to feature, the starting-point payoff, and the
// real business surface + its focal point for each scene. Pure + deterministic; invents nothing.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReviewVideoPlan, VideoScene } from "./plan";
import type { QuickReview } from "../../outreach/quick-review";
import type { SceneWindow } from "./motion";
import { parseStat, type CountSpec } from "./count";

/** How much the surface is dimmed for legibility (M2.2). Evidence stays bright; only backdrops darken. */
export type SurfaceTreatment = "EVIDENCE_SURFACE" | "ATMOSPHERIC_SURFACE" | "BACKGROUND_SURFACE";

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
  /** M2.2 legibility treatment — evidence bright, atmospheric medium, backdrop dim. */
  treatment: SurfaceTreatment;
}

/** The staged 3-beat proof scene (M2.2): review volume → rating → the underused-proof contrast. */
export interface ReviewProof {
  count: CountSpec | null;   // 0 → 950+
  countLabel: string;
  rating: CountSpec | null;  // 0.0 → 4.8 (rendered with ★)
  ratingLabel: string;
  zero: string;              // "0" — supporting contrast, NOT counted, revealed last
  zeroLabel: string;
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
  /** Count-up spec for the stat number (M2.2) — animates 0 → value, exact endpoint. */
  count?: CountSpec | null;
  /** Staged proof data (M2.2) — replaces the simultaneous comparison. */
  review?: ReviewProof | null;
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
        return { ...base, value: s.primaryValue, label: (s.primaryLabel ?? "").toUpperCase(), count: s.primaryValue ? parseStat(s.primaryValue) : null, hook: splitHook(s.headline) };
      case "COMPARISON": {
        const c = s.comparison;
        const ratingStr = c?.leftLabel.match(/(\d(?:\.\d)?)\s*(?:★|stars?)/i)?.[1] ?? null;
        const countLabel = (c?.leftLabel.replace(/·?\s*\d(?:\.\d)?\s*(?:★|stars?).*/i, "").replace(/·/g, "").trim().toUpperCase()) || "CUSTOMER REVIEWS";
        return { ...base, hook: splitHook(s.headline), review: c ? {
          count: parseStat(c.left), countLabel,
          rating: ratingStr ? parseStat(ratingStr) : null, ratingLabel: "AVERAGE RATING",
          zero: c.right, zeroLabel: c.rightLabel.toUpperCase(),
        } : null };
      }
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

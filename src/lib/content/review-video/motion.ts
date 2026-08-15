// ─────────────────────────────────────────────────────────────────────────────
// Motion system (M2) — the deterministic timing/easing grammar shared with the Artifex content videos.
// This is the PURE core: cubic-bezier easing, keyframe interpolation, and the per-scene schedule that
// turns a plan + durations into absolute time windows. The HTML/CDP renderer evaluates these to drive
// every frame, so motion is reproducible frame-for-frame (no wall-clock) and testable without a browser.
//
// The named MOTIONS below encode the content system's grammar (entrance velocity, settle, stagger) so
// review videos and content videos move the same way. Values mirror the field-note scene easing.
// ─────────────────────────────────────────────────────────────────────────────

/** Standard easing curves (cubic-bezier), matching the content system's feel. */
export const EASE = {
  // Editorial settle — fast in, long gentle settle (the content system's signature reveal).
  out: [0.16, 1, 0.3, 1] as Bezier,          // "expo-ish" ease-out
  inOut: [0.65, 0, 0.35, 1] as Bezier,
  soft: [0.25, 0.46, 0.45, 0.94] as Bezier,
  linear: [0, 0, 1, 1] as Bezier,
};
export type Bezier = [number, number, number, number];

/** Evaluate a cubic-bezier easing at progress u∈[0,1]. Newton-refined solve of x(t)=u → y(t). Pure. */
export function bezier([x1, y1, x2, y2]: Bezier, u: number): number {
  const t = clamp01(u);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (p: number) => ((ax * p + bx) * p + cx) * p;
  const dfx = (p: number) => (3 * ax * p + 2 * bx) * p + cx;
  let p = t;
  for (let i = 0; i < 8; i++) { const x = fx(p) - t; if (Math.abs(x) < 1e-6) break; const d = dfx(p); if (Math.abs(d) < 1e-6) break; p -= x / d; }
  p = clamp01(p);
  return ((ay * p + by) * p + cy) * p;
}

export function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }

/** Progress of a value that starts at `start` and lasts `dur`, eased. 0 before, 1 after. Pure. */
export function progress(now: number, start: number, dur: number, ease: Bezier = EASE.out): number {
  if (dur <= 0) return now >= start ? 1 : 0;
  return bezier(ease, clamp01((now - start) / dur));
}

/** Interpolate a numeric track: keyframes [ [tSec, value], … ] evaluated at `now` with easing between
 *  adjacent frames. Holds the endpoints outside the range. Pure — used for transforms/opacity. */
export function track(now: number, keys: Array<[number, number]>, ease: Bezier = EASE.out): number {
  if (!keys.length) return 0;
  if (now <= keys[0][0]) return keys[0][1];
  if (now >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  for (let i = 1; i < keys.length; i++) {
    const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
    if (now <= t1) { const u = bezier(ease, (now - t0) / (t1 - t0)); return v0 + (v1 - v0) * u; }
  }
  return keys[keys.length - 1][1];
}

// ── Named motion primitives (the shared grammar) — timing in seconds, plus easing. Config only, so
//    both the content and review renderers can consume the SAME movement vocabulary. ────────────────
export interface MotionSpec { in: number; hold: number; out: number; ease: Bezier; travel: number }
export const MOTIONS: Record<string, MotionSpec> = {
  // A line/phrase reveal: rises + fades in, holds, fades as the scene leaves.
  TextReveal: { in: 0.62, hold: 0, out: 0.4, ease: EASE.out, travel: 26 },
  // A number lands large: quick scale-in with an editorial settle, then holds.
  NumberImpact: { in: 0.72, hold: 0, out: 0.4, ease: EASE.out, travel: 0 },
  // A captured surface drifts/pushes slowly the whole scene (Ken-Burns, restrained).
  SurfacePush: { in: 0.5, hold: 0, out: 0.5, ease: EASE.soft, travel: 0.06 },
  // A crop/mask opens to reveal evidence.
  MaskReveal: { in: 0.7, hold: 0, out: 0.35, ease: EASE.out, travel: 0 },
  // Cross-scene carry: a value/element persists briefly across the cut.
  Carry: { in: 0.45, hold: 0, out: 0.45, ease: EASE.inOut, travel: 0 },
};

/** Stagger helper — the nth element's start offset for a group reveal. */
export function stagger(index: number, step = 0.12): number { return index * step; }

// ── Scene schedule — absolute time windows for the timeline ───────────────────────────────────────
export interface SceneWindow { id: string; startSec: number; endSec: number; durSec: number; index: number }

/** Build absolute windows from per-scene durations. A small CROSSFADE overlap lets transitions carry
 *  across the cut instead of a hard fade-to-black. Pure + deterministic. */
export function buildSchedule(sceneIds: string[], durations: number[]): SceneWindow[] {
  const out: SceneWindow[] = [];
  let cursor = 0;
  for (let i = 0; i < sceneIds.length; i++) {
    const dur = Math.max(0.5, durations[i] ?? 2);
    out.push({ id: sceneIds[i], index: i, startSec: round3(cursor), endSec: round3(cursor + dur), durSec: round3(dur) });
    cursor += dur;
  }
  return out;
}

/** Total timeline length. */
export function totalDuration(schedule: SceneWindow[]): number { return schedule.length ? round3(schedule[schedule.length - 1].endSec) : 0; }

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

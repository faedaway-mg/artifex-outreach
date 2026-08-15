// ─────────────────────────────────────────────────────────────────────────────
// Sound design (M2.2) — a small, restrained, DETERMINISTIC sound-design layer that reinforces visual
// events without competing with them. Lucas narration is always priority #1; these events sit well
// below it. Effects are SYNTHESIZED locally (ffmpeg lavfi — the same philosophy as the Field Note
// content pipeline), never sourced from packs. Events are DERIVED from the scene timeline so they are
// reproducible and testable; the render script realizes each event as a low-gain sine/noise gesture.
// ─────────────────────────────────────────────────────────────────────────────
import type { SceneWindow } from "./motion";
import type { PageScene } from "./scene-plan";

export type SoundType =
  | "SOFT_IMPACT"      // a number/stat settles
  | "AIR_WHOOSH"       // a major surface transition
  | "SOFT_TRANSITION"  // a lighter scene change
  | "PAYOFF_SWELL"     // the "where we'd start" payoff
  | "ARTIFEX_CLOSE";   // the closing mark

export interface SoundEvent {
  type: SoundType;
  at: number;      // seconds
  gain: number;    // linear 0..1, conservatively below the voice
  sceneId: string;
}

// Conservative gains — every event sits clearly under Lucas. Tuned low on purpose.
export const SFX_GAIN: Record<SoundType, number> = {
  SOFT_IMPACT: 0.16, AIR_WHOOSH: 0.10, SOFT_TRANSITION: 0.08, PAYOFF_SWELL: 0.12, ARTIFEX_CLOSE: 0.14,
};

// Where in a stat/count scene the number resolves (so the impact lands on the endpoint, near the
// spoken value). Matches the count-up endSec fraction used by the renderer.
export const COUNT_RESOLVE_FRAC = 0.55;

/** Derive the sound events from the scene schedule + page scenes. Deterministic, de-duplicated, ordered.
 *  Rules: a stat/comparison endpoint → SOFT_IMPACT at the count resolve; a scene entrance → a transition
 *  (AIR_WHOOSH for a surface-backed scene, SOFT_TRANSITION otherwise); the payoff → PAYOFF_SWELL; the
 *  close → ARTIFEX_CLOSE. The comparison scene gets TWO impacts (950+ then 4.8★). */
export function deriveSoundEvents(scenes: PageScene[], schedule: SceneWindow[]): SoundEvent[] {
  const win = Object.fromEntries(schedule.map((w) => [w.id, w]));
  const out: SoundEvent[] = [];
  scenes.forEach((s, i) => {
    const w = win[s.id];
    if (!w) return;
    // Scene entrance: the first scene has no incoming transition; a surface-backed change whooshes.
    if (i > 0) out.push({ type: s.surface ? "AIR_WHOOSH" : "SOFT_TRANSITION", at: round3(w.startSec + 0.06), gain: s.surface ? SFX_GAIN.AIR_WHOOSH : SFX_GAIN.SOFT_TRANSITION, sceneId: s.id });
    // Number impacts on the resolve.
    if (s.type === "STRUCTURE" || s.type === "STAT_REVEAL") {
      out.push({ type: "SOFT_IMPACT", at: round3(w.startSec + COUNT_RESOLVE_FRAC * w.durSec), gain: SFX_GAIN.SOFT_IMPACT, sceneId: s.id });
    } else if (s.type === "COMPARISON") {
      out.push({ type: "SOFT_IMPACT", at: round3(w.startSec + 0.32 * w.durSec), gain: SFX_GAIN.SOFT_IMPACT, sceneId: s.id });       // 950+ resolves
      out.push({ type: "SOFT_IMPACT", at: round3(w.startSec + 0.55 * w.durSec), gain: SFX_GAIN.SOFT_IMPACT * 0.9, sceneId: s.id }); // 4.8★ resolves
    } else if (s.type === "STARTING_POINT") {
      out.push({ type: "PAYOFF_SWELL", at: round3(w.startSec + 0.15 * w.durSec), gain: SFX_GAIN.PAYOFF_SWELL, sceneId: s.id });
    } else if (s.type === "CLOSE") {
      out.push({ type: "ARTIFEX_CLOSE", at: round3(w.startSec + 0.2 * w.durSec), gain: SFX_GAIN.ARTIFEX_CLOSE, sceneId: s.id });
    }
  });
  // De-dupe any coincident identical events and order by time.
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.at - b.at)
    .filter((e) => { const k = `${e.type}@${e.at}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** ffmpeg lavfi source + filter for each primitive (mono, short). Realized by the render script into a
 *  timed, low-gain SFX bed. Kept here so the vocabulary is one bounded, inspectable place. */
export function sfxRecipe(type: SoundType): { src: string; filter: string; dur: number } {
  switch (type) {
    case "SOFT_IMPACT":     return { src: "sine=frequency=210:duration=0.5", filter: "afade=t=out:st=0.06:d=0.44,lowpass=f=900", dur: 0.5 };
    case "AIR_WHOOSH":      return { src: "anoisesrc=d=0.6:c=pink", filter: "highpass=f=700,lowpass=f=4200,afade=t=in:d=0.2,afade=t=out:st=0.28:d=0.3", dur: 0.6 };
    case "SOFT_TRANSITION": return { src: "anoisesrc=d=0.45:c=pink", filter: "highpass=f=1200,lowpass=f=5000,afade=t=in:d=0.15,afade=t=out:st=0.2:d=0.25", dur: 0.45 };
    case "PAYOFF_SWELL":    return { src: "sine=frequency=174:duration=1.6", filter: "afade=t=in:d=0.6,afade=t=out:st=1.0:d=0.6,lowpass=f=700", dur: 1.6 };
    case "ARTIFEX_CLOSE":   return { src: "sine=frequency=392:duration=0.9", filter: "afade=t=out:st=0.25:d=0.6,lowpass=f=1200", dur: 0.9 };
  }
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

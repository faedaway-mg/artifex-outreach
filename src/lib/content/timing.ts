// ─────────────────────────────────────────────────────────────────────────────
// Scene timing — once real narration audio exists (from whichever voice provider), align the visual
// story to it AUTOMATICALLY. Given the audio's true duration and the narration segments, we allocate
// each segment a share of the timeline proportional to its word count, so scenes and captions land on
// the narration without any manual timestamping. Deterministic and provider-agnostic.
//
// This is the alignment CONTRACT the future renderer consumes; it deliberately does not do word-level
// forced alignment (that can slot in later behind the same SceneTiming shape without callers changing).
// ─────────────────────────────────────────────────────────────────────────────
import type { NarrationScript, SegmentRole } from "./narration";
import type { NarrationAudio } from "./voice";

export interface SceneTiming {
  segmentId: string;
  role: SegmentRole;
  startSec: number;
  endSec: number;
  durationSec: number;
  words: number;
}

/** Distribute the real audio duration across segments by word share. `lead`/`tail` reserve small
 *  silences at the top/end if the audio has them. Rescales cleanly to ANY actual narration length, so
 *  a 0:52 Lucas take and a 1:08 take both align without touching the visual plan. */
export function planSceneTiming(
  script: NarrationScript,
  audio: Pick<NarrationAudio, "durationSeconds">,
  opts: { leadSec?: number; tailSec?: number } = {},
): SceneTiming[] {
  const lead = Math.max(0, opts.leadSec ?? 0);
  const tail = Math.max(0, opts.tailSec ?? 0);
  const total = audio.durationSeconds;
  if (!(total > 0)) throw new Error(`invalid audio duration for timing: ${total}`);
  const spoken = Math.max(0.01, total - lead - tail);
  const totalWords = script.segments.reduce((n, s) => n + s.words, 0) || 1;

  const out: SceneTiming[] = [];
  let cursor = lead;
  script.segments.forEach((s, i) => {
    // Last segment absorbs rounding so the timeline ends exactly at total - tail.
    const isLast = i === script.segments.length - 1;
    const dur = isLast ? Math.max(0, total - tail - cursor) : round3((s.words / totalWords) * spoken);
    const startSec = round3(cursor);
    const endSec = round3(cursor + dur);
    out.push({ segmentId: s.id, role: s.role, startSec, endSec, durationSec: round3(endSec - startSec), words: s.words });
    cursor = endSec;
  });
  return out;
}

/** True when the timing plan tiles the whole audio with no gaps/overlaps — a renderer invariant. */
export function isContiguous(timings: SceneTiming[], audio: Pick<NarrationAudio, "durationSeconds">, tailSec = 0): boolean {
  if (!timings.length) return false;
  for (let i = 1; i < timings.length; i++) if (Math.abs(timings[i].startSec - timings[i - 1].endSec) > 0.01) return false;
  return Math.abs(timings[timings.length - 1].endSec - (audio.durationSeconds - tailSec)) <= 0.05;
}

function round3(n: number): number { return Math.round(n * 1000) / 1000; }

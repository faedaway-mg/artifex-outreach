// ─────────────────────────────────────────────────────────────────────────────
// The Artifex Voice engine.
//
// Not templates — a reusable layer that every piece of generated communication
// (email, follow-up, discovery summary, proposal) can pass through to stay in
// one voice: founder-written, humble, observant, calm, specific, conversational,
// respectful, curious, confident without ego.
//
// It builds on the approved communication guide (the single source of banned
// phrases) and adds the tells that make writing feel automated.
// ─────────────────────────────────────────────────────────────────────────────
import { BANNED_PHRASES } from "../communication-guide";

export const VOICE_PRINCIPLES = [
  "founder-written",
  "humble",
  "observant",
  "calm",
  "specific",
  "conversational",
  "respectful",
  "curious",
  "confident without ego",
] as const;

// Patterns that make writing read like software or an agency wrote it — beyond
// the brand's banned phrases. Each is a "tell" the voice must never produce.
const AVOID_PATTERNS: Array<{ id: string; re: RegExp; why: string }> = [
  { id: "our-analysis", re: /\bour (analysis|research|system|platform|team|engine|tool)\b/i, why: "sounds like software, not a person" },
  { id: "we-identified", re: /\b(we|our\w*) (identified|detected|analyzed|discovered|determined)\b/i, why: "robotic, third-person authority" },
  { id: "leverage", re: /\bleverag(e|ing)\b/i, why: "agency buzzword" },
  { id: "solutions", re: /\b(cutting-edge|best-in-class|world-class|state-of-the-art|next-level|game-?chang\w+|revolutionary)\b/i, why: "marketing hyperbole" },
  { id: "synergy", re: /\bsynerg\w+/i, why: "corporate filler" },
  { id: "reach-out", re: /\breaching out\b/i, why: "sales cliché opener" },
  { id: "circle-back", re: /\b(circle back|touch base|following up|just checking in|bumping this)\b/i, why: "hollow follow-up cliché" },
  { id: "certainty", re: /\b(guarantee|definitely will|will absolutely|100%|proven to)\b/i, why: "overclaims certainty" },
  { id: "urgency", re: /\b(act now|limited time|don'?t miss|last chance|hurry)\b/i, why: "manufactured urgency" },
  { id: "exclaim", re: /!/, why: "exclamation marks read as sales energy" },
  { id: "empty-transition", re: /\b(furthermore|moreover|in conclusion|as such|that being said)\b/i, why: "robotic transition" },
];

export interface VoiceViolation {
  id: string;
  match: string;
  why: string;
}

/** Every avoid-pattern (and banned phrase) found in the text. Empty = clean. */
export function voiceViolations(text: string): VoiceViolation[] {
  const out: VoiceViolation[] = [];
  const lower = text.toLowerCase();
  for (const p of BANNED_PHRASES) {
    if (lower.includes(p.toLowerCase())) out.push({ id: "banned", match: p, why: "banned by the communication guide" });
  }
  for (const p of AVOID_PATTERNS) {
    const m = text.match(p.re);
    if (m) out.push({ id: p.id, match: m[0], why: p.why });
  }
  return out;
}

export function isCleanVoice(text: string): boolean {
  return voiceViolations(text).length === 0;
}

// ── Reading + rhythm measures (shared by quality scoring) ────────────────────
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Silent reading ≈ 200 wpm ≈ 3.3 words/sec. Clamped to a sensible floor. */
export function readingSeconds(text: string): number {
  return Math.max(8, Math.round(wordCount(text) / 3.3));
}

export function sentenceStats(text: string): { count: number; avgWords: number; longest: number } {
  const sentences = text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0) return { count: 0, avgWords: 0, longest: 0 };
  const lengths = sentences.map((s) => wordCount(s));
  return {
    count: sentences.length,
    avgWords: Math.round(lengths.reduce((a, b) => a + b, 0) / sentences.length),
    longest: Math.max(...lengths),
  };
}

// Founder-voice signals — first person, a real name, humility, low pressure.
export function hasFounderSignals(text: string): { firstPerson: boolean; humble: boolean; lowPressure: boolean; introducesSelf: boolean } {
  const t = text.toLowerCase();
  return {
    firstPerson: /\bi (spent|noticed|could|run|went|wanted|mostly|might|think)\b/.test(t),
    humble: /\bi could be wrong|might be wrong|i'?m only seeing|wanted to check|i could have this wrong\b/.test(t),
    lowPressure: /\bno pressure|no worries|if not|no hard feelings|won'?t keep|completely understand\b/.test(t),
    introducesSelf: /\bi run artifex labs|my name'?s jordan|i'?m jordan\b/.test(t),
  };
}

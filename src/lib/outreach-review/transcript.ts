// ─────────────────────────────────────────────────────────────────────────────
// TRANSCRIPT VERIFICATION (mandate 28). Compares a spoken transcript against the current narration to catch a
// WRONG or INCOMPLETE recording BEFORE rendering — while tolerating natural spoken differences (contractions,
// greetings, small word-order changes) when the meaning is equivalent. Provider-agnostic: the transcriber is
// injected (a deterministic fake in tests; the real provider in prod). This module is the pure comparator.
// ─────────────────────────────────────────────────────────────────────────────

export type TranscriptClassification =
  | "MATCH" | "MINOR_VARIATION" | "POSSIBLE_WRONG_RECORDING" | "INCOMPLETE_RECORDING"
  | "TRANSCRIPTION_UNAVAILABLE" | "NEEDS_OPERATOR_CONFIRMATION";

export interface TranscriptResult {
  classification: TranscriptClassification;
  coverage: number;          // 0..1 fraction of narration content words present in the transcript
  lengthRatio: number;       // spoken content words / narration content words
  canAutoRender: boolean;    // MATCH or acceptable MINOR_VARIATION → queue render automatically
  requiresOperator: boolean; // WRONG / INCOMPLETE / UNAVAILABLE / NEEDS_CONFIRMATION
  reason: string;
}

// Natural-speech normalization: lowercase, expand common contractions, drop greetings + filler, strip
// punctuation. This is why "you're" ≈ "you are" and a leading "hi" never fails a match.
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/won't/g, "will not"], [/can't/g, "cannot"], [/n't/g, " not"], [/'re/g, " are"], [/'ll/g, " will"],
  [/'ve/g, " have"], [/'m/g, " am"], [/it's/g, "it is"], [/'s/g, ""], [/'d/g, " would"],
];
const STOP = new Set(["hi", "hey", "hello", "um", "uh", "so", "just", "a", "an", "the", "and", "to", "of", "is", "it", "that", "you", "your", "i", "im", "for", "on", "at", "in", "with", "would", "could", "if"]);

function contentWords(s: string): string[] {
  let t = (s ?? "").toLowerCase();
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  const words = t.match(/[a-z0-9]+/g) ?? [];
  return words.filter((w) => w.length > 1 && !STOP.has(w));
}

/** Compare narration vs spoken transcript. `available=false` → the transcriber produced nothing. */
export function verifyTranscript(narration: string, spoken: string, opts: { available?: boolean } = {}): TranscriptResult {
  if (opts.available === false || !spoken.trim()) {
    return { classification: "TRANSCRIPTION_UNAVAILABLE", coverage: 0, lengthRatio: 0, canAutoRender: false, requiresOperator: true, reason: "transcription unavailable — upload preserved; operator confirmation required" };
  }
  const nWords = contentWords(narration);
  const sWords = contentWords(spoken);
  if (nWords.length === 0) {
    return { classification: "NEEDS_OPERATOR_CONFIRMATION", coverage: 0, lengthRatio: 0, canAutoRender: false, requiresOperator: true, reason: "narration has no content words to compare" };
  }
  const sSet = new Set(sWords);
  const covered = nWords.filter((w) => sSet.has(w)).length;
  const coverage = covered / nWords.length;
  const lengthRatio = sWords.length / nWords.length;

  // A very short recording relative to the script → incomplete (regardless of coverage of the part spoken).
  if (lengthRatio < 0.6 && coverage < 0.85) {
    return { classification: "INCOMPLETE_RECORDING", coverage, lengthRatio, canAutoRender: false, requiresOperator: true, reason: "recording appears incomplete — the spoken text is much shorter than the script" };
  }
  if (coverage >= 0.9) {
    return { classification: "MATCH", coverage, lengthRatio, canAutoRender: true, requiresOperator: false, reason: "spoken narration matches the script" };
  }
  if (coverage >= 0.75) {
    return { classification: "MINOR_VARIATION", coverage, lengthRatio, canAutoRender: true, requiresOperator: false, reason: "minor natural spoken differences — meaning equivalent" };
  }
  if (coverage < 0.5) {
    return { classification: "POSSIBLE_WRONG_RECORDING", coverage, lengthRatio, canAutoRender: false, requiresOperator: true, reason: "the recording may be for a different script — replace or confirm" };
  }
  return { classification: "NEEDS_OPERATOR_CONFIRMATION", coverage, lengthRatio, canAutoRender: false, requiresOperator: true, reason: "partial match — operator confirmation required" };
}

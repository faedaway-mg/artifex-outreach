// ─────────────────────────────────────────────────────────────────────────────
// Style Checker — the natural-language gate for generated conversation.
//
// Every opening conversation the engine produces passes through here before it
// reaches an operator. It hunts the things that make generated copy sound
// generated:
//
//   • repeated phrases   — the same 2–4 word run used twice
//   • repeated words     — a content word leaned on too many times
//   • robotic language   — scripted-cold-caller tells ("I wanted to reach out")
//   • generic filler     — very/really/just/basically/great padding
//   • awkward wording     — run-ons, double words, parallel sentence openers
//
// It returns a report and a numeric score. `rewriteUntilNatural` uses it to keep
// regenerating (and lightly sanitizing) a candidate until the language reads like
// a person wrote it — never returning something that trips the checker while a
// cleaner variant was available.
// ─────────────────────────────────────────────────────────────────────────────

import { BANNED_PHRASES } from "./communication-guide";

export type StyleIssueKind = "repeated-phrase" | "repeated-word" | "awkward" | "robotic" | "filler";

export interface StyleIssue {
  kind: StyleIssueKind;
  detail: string;
  /** 1 = polish, 2 = notable, 3 = must-fix (sounds scripted/robotic). */
  severity: 1 | 2 | 3;
}

export interface StyleReport {
  ok: boolean;
  /** 0–100; 100 is flawless. `ok` is true at 80+ with no severity-3 issue. */
  score: number;
  issues: StyleIssue[];
}

// Words that carry no content — never counted as "repeated words", never the
// meat of a "repeated phrase".
const STOPWORDS = new Set(
  "a an and or but so the to of in on at for with from by as is are was were be been being it its it's this that these those you your you're i i'm we we're they them their he she his her our us do does did done have has had not no yes if then than when what which who how why up out off over under about into onto per via can could would should will shall may might must here there where more most less least own only just also too very really".split(
    /\s+/,
  ),
);

// Scripted / robotic cold-call tells. These are the phrases that instantly mark a
// call as a script. Kept separate from BANNED_PHRASES (which is email-oriented)
// and merged at check time.
const ROBOTIC_MARKERS: string[] = [
  "i wanted to reach out",
  "i'm calling today",
  "i am calling today",
  "the reason i'm calling",
  "the reason for my call",
  "how are you doing today",
  "how are you today",
  "hope you're doing well",
  "hope this finds you well",
  "i'll be honest with you",
  "to be honest with you",
  "does that make sense",
  "if i'm being honest",
  "at the end of the day",
  "as you may know",
  "as you probably know",
  "i'll cut to the chase",
  "let me be transparent",
  "give you a quick call",
  "a quick call",
  "quick question for you",
  "not gonna lie",
  "long story short",
  "without further ado",
];

// Padding that adds words and subtracts meaning. Overuse of any is filler.
const FILLER_WORDS = ["very", "really", "just", "basically", "actually", "literally", "simply", "definitely", "honestly", "essentially", "kind of", "sort of", "you know", "obviously", "truly", "great", "amazing", "incredible"];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Analyze a block of conversational copy for the tells of generated language. */
export function analyzeStyle(text: string): StyleReport {
  const issues: StyleIssue[] = [];
  const lower = ` ${text.toLowerCase().replace(/[’]/g, "'")} `;
  const words = tokenize(text);

  // ── Robotic / banned language ──────────────────────────────────────────────
  const scripted = [...ROBOTIC_MARKERS, ...BANNED_PHRASES];
  for (const p of scripted) {
    if (lower.includes(` ${p} `) || lower.includes(` ${p}.`) || lower.includes(` ${p},`)) {
      issues.push({ kind: "robotic", detail: `scripted phrase: "${p}"`, severity: 3 });
    }
  }

  // ── Repeated content words ─────────────────────────────────────────────────
  const freq = new Map<string, number>();
  for (const w of words) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  for (const [w, n] of freq) {
    if (n >= 3) issues.push({ kind: "repeated-word", detail: `"${w}" appears ${n}×`, severity: 2 });
    else if (n === 2 && words.length < 60) issues.push({ kind: "repeated-word", detail: `"${w}" repeats in a short passage`, severity: 1 });
  }

  // ── Repeated phrases (bigrams + trigrams with at least one content word) ────
  for (const n of [3, 2]) {
    const grams = new Map<string, number>();
    for (let i = 0; i + n <= words.length; i++) {
      const slice = words.slice(i, i + n);
      if (slice.every((w) => STOPWORDS.has(w))) continue;
      const g = slice.join(" ");
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    for (const [g, c] of grams) {
      if (c >= 2) issues.push({ kind: "repeated-phrase", detail: `"${g}" used ${c}×`, severity: n >= 3 ? 3 : 2 });
    }
  }

  // ── Generic filler ─────────────────────────────────────────────────────────
  for (const f of FILLER_WORDS) {
    const re = new RegExp(`(^|[^a-z])${f.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z]|$)`, "gi");
    const hits = (text.match(re) || []).length;
    if (hits >= 2) issues.push({ kind: "filler", detail: `filler "${f}" ×${hits}`, severity: 2 });
    else if (hits === 1 && (f === "just" || f === "very" || f === "really" || f === "basically")) {
      issues.push({ kind: "filler", detail: `filler "${f}"`, severity: 1 });
    }
  }

  // ── Awkward wording ────────────────────────────────────────────────────────
  const sents = sentences(text);
  // Doubled words ("the the").
  const dbl = text.match(/\b(\w+)\s+\1\b/i);
  if (dbl) issues.push({ kind: "awkward", detail: `doubled word: "${dbl[0]}"`, severity: 3 });
  // Over-long, comma-heavy run-ons.
  for (const s of sents) {
    const wc = s.split(/\s+/).length;
    const commas = (s.match(/,/g) || []).length;
    if (wc > 34) issues.push({ kind: "awkward", detail: `run-on sentence (${wc} words)`, severity: 2 });
    if (commas >= 4) issues.push({ kind: "awkward", detail: `too many clauses (${commas} commas)`, severity: 1 });
  }
  // Consecutive sentences opening on the same word ("I … I …").
  for (let i = 1; i < sents.length; i++) {
    const a = firstWord(sents[i - 1]);
    const b = firstWord(sents[i]);
    if (a && a === b) issues.push({ kind: "awkward", detail: `two sentences open with "${a}"`, severity: 2 });
  }
  // Double spaces / stray whitespace.
  if (/\s{2,}/.test(text.replace(/\n/g, " "))) issues.push({ kind: "awkward", detail: "irregular spacing", severity: 1 });

  const score = scoreFrom(issues);
  const hasBlocker = issues.some((i) => i.severity === 3);
  return { ok: score >= 80 && !hasBlocker, score, issues };
}

function firstWord(s: string): string {
  const m = s.toLowerCase().match(/[a-z']+/);
  return m ? m[0] : "";
}

function scoreFrom(issues: StyleIssue[]): number {
  const penalty = issues.reduce((sum, i) => sum + i.severity * 6, 0);
  return Math.max(0, 100 - penalty);
}

// ── Light mechanical rewrite ───────────────────────────────────────────────────
// Not a substitute for a genuinely better variant — it strips the cheap tells
// (filler words, doubled words, stray whitespace) so a near-good candidate lands
// clean. The engine's real variety comes from distinct handcrafted variants; this
// just removes the lint.
export function sanitize(text: string): string {
  let out = text;
  // Drop filler adverbs that add words and subtract meaning.
  out = out.replace(/\b(just|very|really|basically|actually|simply|honestly|literally)\s+/gi, "");
  out = out.replace(/\b(\w+)\s+\1\b/gi, "$1"); // collapse doubled words
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\s+([.,;:!?])/g, "$1");
  out = out.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  // Re-capitalize sentence starts we may have emptied.
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre, c) => pre + c.toUpperCase());
  return out.trim();
}

export interface RewriteOptions {
  /** Max candidates to try before returning the best available. */
  maxAttempts?: number;
  /** Apply the mechanical sanitize pass to each candidate. Default true. */
  sanitizePass?: boolean;
}

export interface RewriteResult {
  text: string;
  report: StyleReport;
  attempts: number;
  /** True if a fully natural (ok) candidate was found. */
  natural: boolean;
}

/**
 * Keep asking `generate` for a fresh candidate until the style checker is happy,
 * or we exhaust attempts — then return the best-scoring one we saw. `generate`
 * receives the attempt index so it can rotate to a genuinely different variant.
 *
 * This is the "automatically rewrite until natural" loop: distinct variants in,
 * the most natural one out, never a scripted-sounding result while a cleaner
 * option existed.
 */
export function rewriteUntilNatural(generate: (attempt: number) => string, opts: RewriteOptions = {}): RewriteResult {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 6);
  const doSanitize = opts.sanitizePass ?? true;
  let best: RewriteResult | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = generate(attempt);
    const text = doSanitize ? sanitize(raw) : raw;
    const report = analyzeStyle(text);
    const candidate: RewriteResult = { text, report, attempts: attempt + 1, natural: report.ok };
    if (report.ok) return candidate;
    if (!best || report.score > best.report.score) best = candidate;
  }
  return best!;
}

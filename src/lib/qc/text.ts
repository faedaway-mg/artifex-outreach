// ─────────────────────────────────────────────────────────────────────────────
// Deterministic, offline text linting for QC.
//
// This is intentionally NOT an LLM grammar check — the OS is mock-by-default and
// must run with zero keys. These are high-precision, low-false-positive checks that
// catch the failures that actually make a generated report look broken: leftover
// template placeholders, doubled words, misspellings from a curated list, spacing
// and punctuation defects, and near-duplicate content. Precision is favored over
// recall so QC never blocks a clean report.
// ─────────────────────────────────────────────────────────────────────────────

// Curated business-writing misspellings → correction. Kept small and unambiguous.
export const COMMON_MISSPELLINGS: Record<string, string> = {
  recieve: "receive",
  recieved: "received",
  seperate: "separate",
  seperately: "separately",
  definately: "definitely",
  occured: "occurred",
  occurance: "occurrence",
  untill: "until",
  wich: "which",
  teh: "the",
  adn: "and",
  bussiness: "business",
  buisness: "business",
  managment: "management",
  enviroment: "environment",
  accomodate: "accommodate",
  acheive: "achieve",
  beleive: "believe",
  calender: "calendar",
  garantee: "guarantee",
  gaurantee: "guarantee",
  independant: "independent",
  maintainance: "maintenance",
  maintenence: "maintenance",
  neccessary: "necessary",
  necesary: "necessary",
  oppertunity: "opportunity",
  opportunties: "opportunities",
  posession: "possession",
  proffesional: "professional",
  reccomend: "recommend",
  recomend: "recommend",
  refered: "referred",
  succesful: "successful",
  sucessful: "successful",
  tcommorow: "tomorrow",
  tomorow: "tomorrow",
  wesbite: "website",
  webiste: "website",
  responsdive: "responsive",
  scheudle: "schedule",
  schedual: "schedule",
  appintment: "appointment",
  apointment: "appointment",
  costumer: "customer",
  custromer: "customer",
};

const WORD = /[A-Za-z][A-Za-z'’]*/g;

/** Leftover template placeholders: `[bracket]`, `{{mustache}}`, `<angle>`, `TODO`. */
export function findTemplatePlaceholders(text: string): string[] {
  const out: string[] = [];
  const patterns = [/\[[^\]]{1,60}\]/g, /\{\{[^}]{1,60}\}\}/g, /<[a-z][a-z0-9 _-]{1,40}>/gi, /\bTODO\b|\bTBD\b|\bFIXME\b|\bXXX\b|\bLOREM\b/gi];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) out.push(...m);
  }
  return dedupe(out);
}

/** Immediately repeated words: "the the", "is is" (case-insensitive). */
export function findDoubledWords(text: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Za-z]+)\s+\1\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Legitimately-doubled words are rare in this content; "had had", "that that"
    // exist but are uncommon enough that flagging as a warning is acceptable.
    out.push(m[0]);
  }
  return dedupe(out);
}

/** Misspellings from the curated list. Returns `word → correction`. */
export function findMisspellings(text: string): Array<{ word: string; correction: string }> {
  const out: Array<{ word: string; correction: string }> = [];
  const seen = new Set<string>();
  const words = text.match(WORD) ?? [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (COMMON_MISSPELLINGS[lower] && !seen.has(lower)) {
      seen.add(lower);
      out.push({ word: w, correction: COMMON_MISSPELLINGS[lower] });
    }
  }
  return out;
}

/** Spacing defects: space before punctuation, double spaces, missing space after. */
export function findSpacingIssues(text: string): string[] {
  const out: string[] = [];
  if (/[ \t][,.;:!?]/.test(text)) out.push("space before punctuation");
  if (/ {2,}/.test(text.replace(/\n/g, " "))) out.push("double space");
  // Missing space after punctuation. `.!?` only when followed by an uppercase
  // letter (a sentence boundary) so bare lowercase domains like "labs.tech" and
  // abbreviations are not flagged; `,;:` when followed by any letter. A lowercase
  // letter is required before the mark so decimals/times (1,000 / 10:30) are safe.
  if (/[a-z][.!?][A-Z]/.test(text) || /[a-z][,;:][A-Za-z]/.test(text)) out.push("missing space after punctuation");
  if (/\s$/.test(text) || /^\s/.test(text)) out.push("leading/trailing whitespace");
  return out;
}

/** Punctuation/capitalization defects likely to read as sloppy. */
export function findGrammarIssues(text: string): string[] {
  const out: string[] = [];
  if (/([!?]){2,}/.test(text)) out.push("repeated end punctuation");
  if (/[a-z] {0,1}\.{2}(?!\.)/.test(text)) out.push("double period");
  if (/,,|;;|::/.test(text)) out.push("doubled punctuation");
  // Article misuse: "a" before a vowel-initial word / "an" before a consonant.
  if (/\ba\s+[aeiou]\w+/i.test(stripArticleExceptions(text))) out.push('"a" before a vowel sound');
  if (/\ban\s+[bcdfgjklmnpqrstvwxyz]\w+/i.test(stripArticleExceptions(text))) out.push('"an" before a consonant sound');
  // Sentence should start uppercase (first non-space char).
  const firstChar = text.trim().charAt(0);
  if (firstChar && /[a-z]/.test(firstChar)) out.push("sentence does not start with a capital letter");
  // Unbalanced brackets/quotes.
  if (countChar(text, "(") !== countChar(text, ")")) out.push("unbalanced parentheses");
  const dq = countChar(text, '"');
  if (dq % 2 !== 0) out.push("unbalanced quotes");
  return out;
}

// Common exceptions where the simple article heuristic would false-positive.
function stripArticleExceptions(text: string): string {
  return text
    .replace(/\ban\s+(one|once|unique|union|united|user|useful|university|european|hour|honest|honor)\b/gi, "")
    .replace(/\ba\s+(hour|honest|honor|mvp|ai|hr|x-)/gi, "");
}

/** Normalized form for near-duplicate detection across sections. */
export function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard similarity of word sets — cheap near-duplicate signal. */
export function similarity(a: string, b: string): number {
  const wa = new Set(normalizeForCompare(a).split(" ").filter(Boolean));
  const wb = new Set(normalizeForCompare(b).split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function countChar(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

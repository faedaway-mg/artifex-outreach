// ─────────────────────────────────────────────────────────────────────────────
// PROPOSAL NARRATION QUALITY EVALUATOR (mandate 25). Pure + dependency-injected: given a proposal narration,
// the company identity, the VERIFIED findings/evidence available, and (optionally) other proposal scripts,
// it returns one stable classification + the signals behind it. Specificity + evidence matter more than raw
// length: a long generic script FAILS; a concise but highly specific, evidence-backed script may PASS.
// ─────────────────────────────────────────────────────────────────────────────
export type NarrationQuality =
  | "GOOD" | "TOO_SHORT" | "GENERIC" | "TOO_SIMILAR" | "INSUFFICIENT_EVIDENCE" | "UNSUPPORTED_CLAIMS" | "NEEDS_REVIEW";

export interface NarrationQualityConfig {
  wordsPerMinute: number;      // spoken-word rate for duration estimate
  preferredMinSec: number;     // ~45s
  preferredMaxSec: number;     // ~75s
  hardShortSec: number;        // below this → TOO_SHORT (~35s)
  targetWordsMin: number;      // ~100
  targetWordsMax: number;      // ~170
  similarityThreshold: number; // 0..1 fraction of shared substantive sentences → TOO_SIMILAR
}
export const DEFAULT_NARRATION_CONFIG: NarrationQualityConfig = {
  wordsPerMinute: 150, preferredMinSec: 45, preferredMaxSec: 75, hardShortSec: 35,
  targetWordsMin: 100, targetWordsMax: 170, similarityThreshold: 0.6,
};

export interface NarrationEvidence {
  businessName: string;
  findings: string[];              // verified, directly-observed finding observations
  hasScreenshot?: boolean;
  hasApprovedRecommendation?: boolean;
}

export interface NarrationQualityInput {
  narration: string;
  evidence: NarrationEvidence;
  otherScripts?: Array<{ leadId: string; narration: string }>; // for cross-company similarity
  config?: Partial<NarrationQualityConfig>;
}

export interface NarrationQualityResult {
  classification: NarrationQuality;
  wordCount: number;
  estimatedSeconds: number;
  signals: {
    companyNameUsed: boolean;
    companySpecific: boolean;      // references a verified finding / evidence, not just the name
    hasObservation: boolean;
    hasWhyItMatters: boolean;
    hasRecommendation: boolean;
    hasBenefit: boolean;
    hasCTA: boolean;
    genericFiller: boolean;
    unsupportedClaims: string[];   // the specific invented claims detected
    maxSimilarity: number;         // 0..1 vs the most similar other script
    similarTo: string | null;
  };
  reasons: string[];
}

const STOP = new Set("a an the and or but if then of to in on for with your you we our it is are be that this at as from by".split(" "));
const words = (s: string) => (s.trim().match(/[A-Za-z0-9']+/g) ?? []);
const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 0);

/** Normalize a sentence for similarity: lowercase, drop the company name + numbers + punctuation + stopwords. */
function normSentence(s: string, businessName: string): string {
  const bn = businessName.toLowerCase().split(/\s+/).filter(Boolean);
  return words(s.toLowerCase())
    .filter((w) => !STOP.has(w) && !bn.includes(w) && !/^\d+$/.test(w))
    .join(" ");
}
const GREETING_CTA = /\b(hi|hello|hey|thanks|thank you|reply|no pressure|no worries|just reply|reach out|let me know|book|call)\b/i;

// Invented claims a proposal must NEVER make unless the evidence proves them (mandate 25 §B7).
const UNSUPPORTED_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b\d+%/, label: "a specific percentage" },
  { re: /\$\s?\d/, label: "a revenue/dollar figure" },
  { re: /\b(revenue|sales|conversion rate|conversions|traffic|click-through|ROI)\b/i, label: "a business-results metric" },
  { re: /\b(customers?|people|clients?)\s+(complain|are complaining|told us|said)\b/i, label: "a fabricated customer complaint" },
  { re: /\b(as we discussed|you (said|mentioned|asked|told me)|per our (call|conversation)|when we spoke|as promised)\b/i, label: "a prior conversation/promise" },
  { re: /\b(guarantee|guaranteed|we promise|i promise)\b/i, label: "a guarantee/promise" },
  { re: /\b(doubl(e|ing)|tripl(e|ing)|increase[sd]? (sales|revenue|traffic|leads) by)\b/i, label: "a fabricated business result" },
];

export function evaluateNarrationQuality(input: NarrationQualityInput): NarrationQualityResult {
  const cfg = { ...DEFAULT_NARRATION_CONFIG, ...(input.config ?? {}) };
  const text = (input.narration ?? "").trim();
  const bn = input.evidence.businessName ?? "";
  const wc = words(text).length;
  const estimatedSeconds = Math.round((wc * 60) / cfg.wordsPerMinute);

  const lower = text.toLowerCase();
  const normLower = words(lower).filter((w) => !STOP.has(w)).join(" ");
  const companyNameUsed = !!bn && lower.includes(bn.toLowerCase());
  // Company-specific requires a DISTINCTIVE finding PHRASE (adjacent non-stopword pair) to appear — a single
  // common word like "customers" or "online" is not enough (that's how generic copy false-passes).
  const findingShingles = input.evidence.findings.flatMap((f) => {
    const toks = words(f.toLowerCase()).filter((w) => !STOP.has(w) && w.length > 3);
    const pairs: string[] = [];
    for (let i = 0; i < toks.length - 1; i++) pairs.push(`${toks[i]} ${toks[i + 1]}`);
    return pairs;
  });
  const companySpecific = findingShingles.some((sh) => normLower.includes(sh));

  const hasObservation = companySpecific || /\b(notice|noticed|found|see|your (site|website|listing|page)|right now|currently)\b/i.test(text);
  const hasWhyItMatters = /\b(matters|means|so that|because|which (means|is why)|the (issue|problem)|missing out|losing)\b/i.test(text);
  const hasRecommendation = /\b(recommend|suggest|could|should|a simple|adding|add |set up|create|build|fix|improve)\b/i.test(text);
  const hasBenefit = /\b(so you|helps you|makes it easier|capture|win|book more|reach|convert|trust|clearer|save)\b/i.test(text);
  const hasCTA = /\b(reply|reach out|let me know|book|call|chat|happy to|if it'?s useful|worth a)\b/i.test(text);

  // Unsupported claims (unless the exact claim appears verbatim in a verified finding).
  const evidenceBlob = input.evidence.findings.join(" ").toLowerCase();
  const unsupportedClaims = UNSUPPORTED_PATTERNS
    .filter((p) => p.re.test(text) && !p.re.test(evidenceBlob))
    .map((p) => p.label);

  // Cross-company similarity on SUBSTANTIVE sentences (excluding greeting/CTA boilerplate).
  const mySubstantive = sentences(text).filter((s) => !GREETING_CTA.test(s)).map((s) => normSentence(s, bn)).filter((s) => s.length > 8);
  let maxSimilarity = 0; let similarTo: string | null = null;
  for (const other of input.otherScripts ?? []) {
    const theirs = new Set(sentences(other.narration).filter((s) => !GREETING_CTA.test(s)).map((s) => normSentence(s, input.evidence.businessName)).filter((s) => s.length > 8));
    if (!mySubstantive.length || !theirs.size) continue;
    const shared = mySubstantive.filter((s) => theirs.has(s)).length;
    const sim = shared / Math.max(mySubstantive.length, theirs.size);
    if (sim > maxSimilarity) { maxSimilarity = sim; similarTo = other.leadId; }
  }

  // Generic filler: long-ish but not company-specific and no evidence-backed recommendation.
  const genericFiller = !companySpecific && (!hasRecommendation || !hasObservation);

  const reasons: string[] = [];
  const signals = { companyNameUsed, companySpecific, hasObservation, hasWhyItMatters, hasRecommendation, hasBenefit, hasCTA, genericFiller, unsupportedClaims, maxSimilarity, similarTo };

  // Classification precedence: hard failures first, then length/specificity.
  let classification: NarrationQuality;
  if (unsupportedClaims.length) { classification = "UNSUPPORTED_CLAIMS"; reasons.push(`unsupported claim(s): ${unsupportedClaims.join(", ")}`); }
  else if (input.evidence.findings.length === 0 || !input.evidence.hasScreenshot) { classification = "INSUFFICIENT_EVIDENCE"; reasons.push("no verified findings/screenshot to ground a specific narration"); }
  else if (maxSimilarity >= cfg.similarityThreshold) { classification = "TOO_SIMILAR"; reasons.push(`substantive wording ${Math.round(maxSimilarity * 100)}% shared with ${similarTo}`); }
  else if (estimatedSeconds < cfg.hardShortSec && !companySpecific) { classification = "TOO_SHORT"; reasons.push(`~${estimatedSeconds}s (${wc} words) and not company-specific`); }
  else if (genericFiller) { classification = "GENERIC"; reasons.push("generic — no company-specific observation + evidence-backed recommendation"); }
  else if (companySpecific && hasObservation && hasRecommendation && !unsupportedClaims.length && estimatedSeconds >= cfg.hardShortSec) { classification = "GOOD"; reasons.push(`company-specific + evidence-backed; ~${estimatedSeconds}s`); }
  else { classification = "NEEDS_REVIEW"; reasons.push("borderline — review specificity/structure/duration"); }

  return { classification, wordCount: wc, estimatedSeconds, signals, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPAND-AND-PERSONALIZE COMPOSER (mandate 25 §B7, mandate 26 §1 regeneration). Deterministic, evidence-
// GROUNDED narration composer. It NEVER invents: every material statement is slotted from a canonical
// evidence finding and carries that finding's id. If the evidence is insufficient (no verified findings) it
// produces NOTHING and returns a blocker — the operator sees "Needs Evidence", not filler.
//
// This is the deterministic, always-available composer. It is NOT an LLM: it can never fabricate a metric,
// a conversation, a promise, or a result because it only ever restates verified evidence in low-pressure
// phrasing. The output is graded by evaluateNarrationQuality so the operator sees the same signals.
//
// REGENERATION (mandate 26 §1A): "Regenerate" must produce a GENUINELY DIFFERENT candidate, not the same
// text. We enumerate deterministic recipes — (which grounded finding anchors the draft) × (which low-pressure
// phrasing bank frames it) — dedupe by resulting text, and expose them as distinct `variant` indices. Every
// variant is still 100% evidence-grounded (only the *framing* words change; the *claims* are the verified
// findings). When the operator asks for a variant beyond the distinct set, we honestly report
// `noSafeAlternative` instead of silently repeating: the evidence permits no further materially-different draft.
// ─────────────────────────────────────────────────────────────────────────────
import { evaluateNarrationQuality, type NarrationQualityResult } from "./narration-quality";

/** One canonical, verified evidence finding about a company. `id` is the stable evidence id every
 *  expanded statement must map back to. Only `observation` is required; impact/recommendation/benefit
 *  are used when present and NEVER fabricated when absent. */
export interface EvidenceFinding {
  id: string;
  observation: string;         // what was directly observed (verified)
  impact?: string | null;      // why it matters (verified) — optional
  recommendation?: string | null; // the approved specific improvement — optional
  benefit?: string | null;     // the likely practical benefit (verified/approved) — optional
}

export interface ExpansionEvidence {
  businessName: string;
  findings: EvidenceFinding[];
  hasScreenshot?: boolean;
  hasApprovedRecommendation?: boolean;
}

export interface ExpansionOptions {
  /** Which distinct grounded draft to return. 0 = canonical. Higher indices rotate the anchor finding and
   *  the phrasing bank to produce a genuinely different (still evidence-grounded) draft. */
  variant?: number;
}

export type ExpansionSection = "opening" | "observation" | "why_it_matters" | "improvement" | "benefit" | "cta";

export interface ExpansionSentence {
  section: ExpansionSection;
  text: string;
  evidenceIds: string[];   // canonical evidence ids this statement rests on ([] only for boilerplate opening/CTA)
  requiresReview: boolean; // true when the statement is not fully grounded (operator must confirm)
}

export interface ExpansionResult {
  available: boolean;
  blocker: string | null;              // e.g. "no verified findings" — when set, sentences is empty
  sentences: ExpansionSentence[];
  narration: string;                   // assembled draft (empty when unavailable)
  wordCount: number;
  estimatedSeconds: number;
  quality: NarrationQualityResult | null; // graded by the same evaluator the operator sees
  evidenceMap: Array<{ statement: string; evidenceIds: string[]; requiresReview: boolean }>;
  usedEvidenceIds: string[];
  statementsRequiringReview: string[];
  // Regeneration bookkeeping (mandate 26 §1A):
  variant: number;                     // the (clamped) variant actually returned
  variantCount: number;                // how many DISTINCT grounded drafts the evidence supports
  noSafeAlternative: boolean;          // true when the requested variant exceeds variantCount → repeat is honest
  regenerationNote: string | null;     // human explanation when noSafeAlternative is true
}

// Low-pressure connective phrasing. These carry NO factual claim — they only frame verified evidence.
const clip = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
const lower1 = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const words = (s: string) => (s.trim().match(/[A-Za-z0-9']+/g) ?? []);

// ── PHRASING BANKS ────────────────────────────────────────────────────────────
// Each bank is a set of connective frames. NONE introduces a factual claim; they only wrap the verified
// finding text. Rotating banks lets "Regenerate" produce a materially different-sounding draft that is still
// grounded in exactly the same evidence.
interface PhrasingBank {
  opening: (bn: string) => string;
  observation: (obs: string) => string;
  whyGrounded: (impact: string) => string;
  whyUngrounded: string;               // used only when the finding carries no verified impact (requiresReview)
  improvement: (rec: string) => string;
  benefit: (ben: string) => string;
  secondObservation: (obs: string) => string;
  cta: string;
}

const PHRASING_BANKS: PhrasingBank[] = [
  {
    opening: (bn) => `Hi — I spent a few minutes looking at ${bn}, and one thing stood out that I thought was worth flagging.`,
    observation: (obs) => `Right now, ${lower1(clip(obs))}.`,
    whyGrounded: (impact) => `That matters because ${lower1(clip(impact))}.`,
    whyUngrounded: `That's the kind of gap that's easy to miss but worth a look.`,
    improvement: (rec) => `A straightforward fix would be to ${lower1(clip(rec))}.`,
    benefit: (ben) => `The practical upside is that ${lower1(clip(ben))}.`,
    secondObservation: (obs) => `I also noticed ${lower1(clip(obs))}.`,
    cta: `No pressure at all — if it's useful, just reply and I'm happy to walk you through what it would take.`,
  },
  {
    opening: (bn) => `Hi — I took a quick look through ${bn}'s site, and there's one detail I wanted to point out.`,
    observation: (obs) => `At the moment, ${lower1(clip(obs))}.`,
    whyGrounded: (impact) => `The reason that's worth attention is that ${lower1(clip(impact))}.`,
    whyUngrounded: `It's a small thing, but the kind that's usually worth a second look.`,
    improvement: (rec) => `One simple change would be to ${lower1(clip(rec))}.`,
    benefit: (ben) => `In practice, that means ${lower1(clip(ben))}.`,
    secondObservation: (obs) => `I also spotted that ${lower1(clip(obs))}.`,
    cta: `No pressure — if that's helpful, just reply and I can walk you through what it would take.`,
  },
  {
    opening: (bn) => `Hi — I spent a little time on ${bn}'s website, and one thing jumped out at me.`,
    observation: (obs) => `As it stands, ${lower1(clip(obs))}.`,
    whyGrounded: (impact) => `That's significant because ${lower1(clip(impact))}.`,
    whyUngrounded: `That's an easy detail to overlook, but it's worth checking.`,
    improvement: (rec) => `A practical fix here would be to ${lower1(clip(rec))}.`,
    benefit: (ben) => `The upside in practice is that ${lower1(clip(ben))}.`,
    secondObservation: (obs) => `Something else I noticed: ${lower1(clip(obs))}.`,
    cta: `No pressure at all — if it's useful, just reply and I'm glad to explain what's involved.`,
  },
];

interface Recipe { anchor: number; bank: number }

/** Compose ONE grounded draft from a recipe (which finding anchors it, which phrasing bank frames it). */
function composeDraft(bn: string, grounded: EvidenceFinding[], recipe: Recipe): ExpansionSentence[] {
  const bank = PHRASING_BANKS[recipe.bank % PHRASING_BANKS.length];
  const n = grounded.length;
  const primary = grounded[recipe.anchor % n];
  const second = n > 1 ? grounded[(recipe.anchor + 1) % n] : null;
  const sentences: ExpansionSentence[] = [];

  // 1) Company-specific opening — boilerplate framing, no factual claim, so no evidence id.
  sentences.push({ section: "opening", text: bank.opening(bn), evidenceIds: [], requiresReview: false });

  // 2) Verified observation — restated from the finding, grounded in its id.
  sentences.push({ section: "observation", text: bank.observation(primary.observation), evidenceIds: [primary.id], requiresReview: false });

  // 3) Why it matters — ONLY if the finding carries a verified impact; otherwise flag for review, never invent.
  if (primary.impact && primary.impact.trim()) {
    sentences.push({ section: "why_it_matters", text: bank.whyGrounded(primary.impact), evidenceIds: [primary.id], requiresReview: false });
  } else {
    sentences.push({ section: "why_it_matters", text: bank.whyUngrounded, evidenceIds: [], requiresReview: true });
  }

  // 4) Specific improvement — ONLY if an approved recommendation exists on the finding.
  const rec = primary.recommendation && primary.recommendation.trim() ? primary.recommendation.trim() : null;
  if (rec) sentences.push({ section: "improvement", text: bank.improvement(rec), evidenceIds: [primary.id], requiresReview: false });

  // 5) Likely practical benefit — ONLY if the finding carries a verified/approved benefit.
  if (primary.benefit && primary.benefit.trim()) {
    sentences.push({ section: "benefit", text: bank.benefit(primary.benefit), evidenceIds: [primary.id], requiresReview: false });
  }

  // Optionally weave a SECOND grounded finding (keeps it specific, not padded) — observation only.
  if (second && second.id !== primary.id) {
    sentences.push({ section: "observation", text: bank.secondObservation(second.observation), evidenceIds: [second.id], requiresReview: false });
  }

  // 6) Low-pressure CTA — boilerplate, no claim.
  sentences.push({ section: "cta", text: bank.cta, evidenceIds: [], requiresReview: false });
  return sentences;
}

/** Enumerate the DISTINCT grounded drafts the evidence supports, in a deterministic order.
 *  variant 0 is always {anchor 0, bank 0} (the canonical draft, preserved byte-for-byte from mandate 25). */
function distinctVariants(bn: string, grounded: EvidenceFinding[]): ExpansionSentence[][] {
  const anchors = Math.min(grounded.length, 3); // rotate through up to the 3 strongest findings
  const recipes: Recipe[] = [];
  for (let a = 0; a < anchors; a++) {
    for (let b = 0; b < PHRASING_BANKS.length; b++) recipes.push({ anchor: a, bank: b });
  }
  const seen = new Set<string>();
  const out: ExpansionSentence[][] = [];
  for (const r of recipes) {
    const s = composeDraft(bn, grounded, r);
    const key = s.map((x) => x.text).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Compose an evidence-grounded expanded draft. Deterministic: same (evidence, variant) → same draft.
 * Structure follows the §B7/§5 standard — opening, observation, why-it-matters, improvement, benefit, CTA —
 * but ONLY emits the sections it can ground. If it cannot ground an observation, it produces nothing.
 */
export function expandAndPersonalize(evidence: ExpansionEvidence, opts: ExpansionOptions = {}): ExpansionResult {
  const bn = (evidence.businessName ?? "").trim();
  const grounded = (evidence.findings ?? []).filter((f) => f && f.id && (f.observation ?? "").trim().length > 0);

  const empty = (blocker: string): ExpansionResult => ({
    available: false, blocker, sentences: [], narration: "", wordCount: 0, estimatedSeconds: 0,
    quality: null, evidenceMap: [], usedEvidenceIds: [], statementsRequiringReview: [],
    variant: 0, variantCount: 0, noSafeAlternative: false, regenerationNote: null,
  });

  // Never fabricate: without a company and at least one verified finding, there is nothing to ground on.
  // (A screenshot is a downstream RENDER prerequisite — enforced by the render evidence-gate — not a text-
  //  grounding requirement: the narration is grounded in the verified FINDINGS.)
  if (!bn) return empty("no company name — cannot personalize");
  if (grounded.length === 0) return empty("no verified findings — cannot ground a specific narration");

  const variants = distinctVariants(bn, grounded);
  const variantCount = variants.length;
  const requested = Math.max(0, Math.floor(opts.variant ?? 0));
  const noSafeAlternative = requested >= variantCount;
  const idx = variantCount > 0 ? requested % variantCount : 0;
  const sentences = variants[idx];
  const regenerationNote = noSafeAlternative
    ? "This is the strongest grounded draft the current evidence supports — there's no materially different alternative without more verified findings. Edit it directly or add evidence to unlock a new angle."
    : null;

  const rec = grounded[idx % grounded.length]?.recommendation ?? null;
  const narration = sentences.map((s) => s.text).join(" ");
  const wc = words(narration).length;
  const quality = evaluateNarrationQuality({
    narration,
    evidence: {
      businessName: bn,
      findings: grounded.map((f) => f.observation),
      hasScreenshot: true, // text-grounding does not require a screenshot; render gate enforces it separately
      hasApprovedRecommendation: evidence.hasApprovedRecommendation ?? !!rec,
    },
  });

  const evidenceMap = sentences
    .filter((s) => s.evidenceIds.length > 0 || s.requiresReview)
    .map((s) => ({ statement: s.text, evidenceIds: s.evidenceIds, requiresReview: s.requiresReview }));
  const usedEvidenceIds = Array.from(new Set(sentences.flatMap((s) => s.evidenceIds)));
  const statementsRequiringReview = sentences.filter((s) => s.requiresReview).map((s) => s.text);

  return {
    available: true, blocker: null, sentences, narration,
    wordCount: wc, estimatedSeconds: quality.estimatedSeconds, quality,
    evidenceMap, usedEvidenceIds, statementsRequiringReview,
    variant: idx, variantCount, noSafeAlternative, regenerationNote,
  };
}

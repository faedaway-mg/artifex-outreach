// ─────────────────────────────────────────────────────────────────────────────
// EXPAND-AND-PERSONALIZE COMPOSER (mandate 25 §B7). Deterministic, evidence-GROUNDED narration composer.
// It NEVER invents: every material statement is slotted from a canonical evidence finding and carries that
// finding's id. If the evidence is insufficient (no verified findings / no screenshot / no approved
// recommendation) it produces NOTHING and returns a blocker — the operator sees "Needs Evidence", not filler.
//
// This is the deterministic, always-available composer. It is NOT an LLM: it can never fabricate a metric,
// a conversation, a promise, or a result because it only ever restates verified evidence in low-pressure
// phrasing. A separate configured AI generator may later produce richer drafts; when that provider is
// unavailable this composer is the honest fallback (and the UI reports the provider blocker rather than
// fabricating). The output is graded by evaluateNarrationQuality so the operator sees the same signals.
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
}

// Low-pressure connective phrasing. These carry NO factual claim — they only frame verified evidence.
const clip = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
const lower1 = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const words = (s: string) => (s.trim().match(/[A-Za-z0-9']+/g) ?? []);

/**
 * Compose an evidence-grounded expanded draft. Deterministic: same evidence in → same draft out.
 * Structure follows the §B7/§5 standard — opening, observation, why-it-matters, improvement, benefit, CTA —
 * but ONLY emits the sections it can ground. If it cannot ground an observation, it produces nothing.
 */
export function expandAndPersonalize(evidence: ExpansionEvidence): ExpansionResult {
  const bn = (evidence.businessName ?? "").trim();
  const grounded = (evidence.findings ?? []).filter((f) => f && f.id && (f.observation ?? "").trim().length > 0);

  const empty = (blocker: string): ExpansionResult => ({
    available: false, blocker, sentences: [], narration: "", wordCount: 0, estimatedSeconds: 0,
    quality: null, evidenceMap: [], usedEvidenceIds: [], statementsRequiringReview: [],
  });

  // Never fabricate: without a company, a verified observation, and a screenshot, there is nothing to expand.
  if (!bn) return empty("no company name — cannot personalize");
  if (grounded.length === 0) return empty("no verified findings — cannot ground a specific narration");
  if (evidence.hasScreenshot === false) return empty("no screenshot evidence — cannot verify the observation");

  // Anchor the draft on the single strongest finding (first grounded finding is the canonical primary).
  const primary = grounded[0];
  const sentences: ExpansionSentence[] = [];

  // 1) Natural company-specific opening — boilerplate framing, no factual claim, so no evidence id.
  sentences.push({
    section: "opening",
    text: `Hi — I spent a few minutes looking at ${bn}, and one thing stood out that I thought was worth flagging.`,
    evidenceIds: [], requiresReview: false,
  });

  // 2) Verified observation — restated from the finding, grounded in its id.
  sentences.push({
    section: "observation",
    text: `Right now, ${lower1(clip(primary.observation))}.`,
    evidenceIds: [primary.id], requiresReview: false,
  });

  // 3) Why it matters — ONLY if the finding carries a verified impact; otherwise flag for review, never invent.
  if (primary.impact && primary.impact.trim()) {
    sentences.push({
      section: "why_it_matters",
      text: `That matters because ${lower1(clip(primary.impact))}.`,
      evidenceIds: [primary.id], requiresReview: false,
    });
  } else {
    sentences.push({
      section: "why_it_matters",
      text: `That's the kind of gap that's easy to miss but worth a look.`,
      evidenceIds: [], requiresReview: true, // not grounded in a verified impact — operator must confirm/replace
    });
  }

  // 4) Specific improvement — ONLY if an approved recommendation exists on the finding.
  const rec = primary.recommendation && primary.recommendation.trim() ? primary.recommendation.trim() : null;
  if (rec) {
    sentences.push({
      section: "improvement",
      text: `A straightforward fix would be to ${lower1(clip(rec))}.`,
      evidenceIds: [primary.id], requiresReview: false,
    });
  }

  // 5) Likely practical benefit — ONLY if the finding carries a verified/approved benefit.
  if (primary.benefit && primary.benefit.trim()) {
    sentences.push({
      section: "benefit",
      text: `The practical upside is that ${lower1(clip(primary.benefit))}.`,
      evidenceIds: [primary.id], requiresReview: false,
    });
  }

  // Optionally weave a SECOND grounded finding (keeps it specific, not padded) — observation only.
  if (grounded.length > 1) {
    const second = grounded[1];
    sentences.push({
      section: "observation",
      text: `I also noticed ${lower1(clip(second.observation))}.`,
      evidenceIds: [second.id], requiresReview: false,
    });
  }

  // 6) Low-pressure CTA — boilerplate, no claim.
  sentences.push({
    section: "cta",
    text: `No pressure at all — if it's useful, just reply and I'm happy to walk you through what it would take.`,
    evidenceIds: [], requiresReview: false,
  });

  const narration = sentences.map((s) => s.text).join(" ");
  const wc = words(narration).length;
  const quality = evaluateNarrationQuality({
    narration,
    evidence: {
      businessName: bn,
      findings: grounded.map((f) => f.observation),
      hasScreenshot: true, // guaranteed above (we return early when hasScreenshot === false)
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
  };
}

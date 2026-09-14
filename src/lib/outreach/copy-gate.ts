// ─────────────────────────────────────────────────────────────────────────────
// FIRST-TOUCH QUALITY GATE + COPY EVALUATOR (deterministic, fail-closed).
//
// The production send boundary (dispatchStep) runs every first-touch email through
// this gate BEFORE dispatch. Generic / legacy / person-finding / unsupported-claim
// copy CANNOT be selected — it is SUPPRESSED, never "sent anyway". The needle
// doctrine applies to words too: we send because we found something worth saying,
// not because capacity exists.
//
// Pure + fully testable. Judges the actual copy text (+ optional Problem-Reality
// provenance), never model chain-of-thought.
// ─────────────────────────────────────────────────────────────────────────────

// Phrases that mark legacy/generic/person-finding cold copy. A hit is BLOCKING.
export const PROHIBITED_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /surprised by how often/i, why: "generic industry-trivia opener" },
  { re: /whoever (oversees|handles|manages|runs|is responsible for)/i, why: "person-finding without a reason" },
  { re: /best person to (discuss|talk|speak)/i, why: "person-finding CTA before establishing why" },
  { re: /\bare you the (best )?person (who |that )?(handles|manages|oversees|is responsible)/i, why: "routing question with no lead-specific reason" },
  { re: /reaching out to connect with/i, why: "generic connect opener" },
  { re: /we help (businesses|companies|brands|clients)/i, why: "we-help-businesses pitch" },
  { re: /hope (this|the) (email|message) finds you well/i, why: "filler opener" },
  { re: /my name is /i, why: "biographical opener" },
  { re: /i'?m reaching out because/i, why: "template opener" },
  { re: /introduce myself/i, why: "self-introduction opener" },
  { re: /schedule (a )?(quick )?(15|fifteen|30|thirty)[- ]?min/i, why: "meeting-ask before value" },
  { re: /(can|could) we (schedule|set up|book|hop on|jump on)/i, why: "meeting-ask before value" },
  { re: /learn more about your (needs|business|goals)/i, why: "vague discovery ask" },
  { re: /\bsynergy\b/i, why: "consultant jargon" },
  { re: /how (your team|you) manages? (subscribers|marketing|tools)/i, why: "category-only operational question" },
  { re: /different tools for (subscriber|customer|lead) management/i, why: "generic tool observation" },
];

// A definite defect assertion OR a causal-loss claim — only allowed when Problem Reality
// is PROVEN. OBSERVED / NEEDS_MORE_EVIDENCE copy must stay hedged (no defect, no "costing
// you customers"-style causal claim we cannot establish from outside).
const DEFINITE_DEFECT = /\b(your|the) (site|website|booking|form|checkout|scheduler|page) (is|isn'?t|doesn'?t|fails|breaks|won'?t|can'?t)\b|is broken|is failing|doesn'?t work|\b(costing|losing) you\b|\b(cost|lose|losing|missed?|missing out on) (you )?(customers|clients|patients|bookings|revenue|sales|money|business|leads)\b/i;
// Hedged / observed language — safe even without proof.
const HEDGED = /\b(i (wasn'?t|couldn'?t|can'?t) (sure|tell)|noticed|i might be wrong|from the outside|not sure if|i think|it looks like|appears to|seemed)\b/i;
// A low-friction, non-meeting CTA (send/show/ask-if-useful/own-this).
const SOFT_CTA = /\b(happy to send|i can send|send (you |over )?|show you what|if it'?s useful|no pressure|do you own|are you the person who owns|worth a look|thought i'?d (mention|flag))\b/i;

export type CopyVerdict = "SEND" | "NEEDS_ATTENTION" | "SUPPRESSED";

export interface CopyScores {
  genericness: number;   // 0 good … 1 bad (blocking if high)
  specificity: number;   // 0..1 (higher better)
  claimSafety: number;   // 0..1
  ctaFriction: number;   // 0 good … 1 bad
  humanness: number;     // 0..1
  leadRelevance: number; // 0..1
}

export interface CopyEvalInput {
  subject: string;
  body: string;
  businessName: string;
  /** first name if known — its presence is not required, but generic-only is */
  contactName?: string | null;
  /** a specific observation/finding phrase the copy should reflect, if any */
  observation?: string | null;
  /** Problem-Reality state, if known: PROVEN allows a definite defect claim */
  problemRealityStatus?: string | null;
}

export interface CopyEvaluation {
  verdict: CopyVerdict;
  pass: boolean;            // true ONLY for SEND
  reasons: string[];        // structured, human-readable (no chain-of-thought)
  scores: CopyScores;
}

function mentionsBusiness(text: string, businessName: string): boolean {
  const core = (businessName || "").replace(/\b(the|inc|llc|co|company|dental|clinic|spa|salon)\b/gi, "").trim();
  const tokens = core.split(/\s+/).filter((w) => w.length >= 4);
  return tokens.some((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text));
}

// Generic B2B filler that marks a "newly worded generic" email even when it dodges
// every banned phrase — used to catch genericness that isn't a literal prohibited hit.
const GENERIC_FILLER = /\b(digital presence|grow your business|take your business to the next level|drive (more )?(revenue|growth|results|leads)|streamline your (operations|workflow)|boost your|maximize your|unlock (growth|potential)|cutting[- ]edge|state[- ]of[- ]the[- ]art|industry[- ]leading|one[- ]stop shop|solutions? (provider|for your))\b/i;

/** Evaluate a first-touch email. Fail closed: only a clean, specific email SENDs. */
export function evaluateFirstTouchCopy(i: CopyEvalInput): CopyEvaluation {
  const text = `${i.subject}\n${i.body}`;
  const reasons: string[] = [];

  // 1) Prohibited legacy/generic/person-finding phrases — BLOCKING. Generic B2B
  //    filler ALSO counts toward genericness (catches newly worded generic copy).
  const hits = PROHIBITED_PATTERNS.filter((p) => p.re.test(text));
  const fillerHit = GENERIC_FILLER.test(text);
  const genericness = Math.min(1, hits.length * 0.5 + (fillerHit ? 0.5 : 0));
  for (const h of hits) reasons.push(`prohibited phrase: ${h.why}`);
  if (fillerHit) reasons.push("generic B2B filler (no lead-specific substance)");

  // 2) Lead relevance: must reference THIS business or a specific observation,
  //    not category/contact only. Checked across subject + body.
  const businessRef = mentionsBusiness(text, i.businessName);
  const hasObservation = Boolean(i.observation && i.observation.trim().length > 0);
  const leadRelevance = businessRef || hasObservation ? 1 : 0;
  if (!businessRef && !hasObservation) reasons.push("no lead-specific reason (category/contact-only personalization)");

  // 3) Claim safety: a definite defect claim requires PROVEN; hedged is always ok.
  const asserts = DEFINITE_DEFECT.test(i.body) && !HEDGED.test(i.body);
  const proven = (i.problemRealityStatus ?? "").toUpperCase() === "PROVEN";
  const claimSafety = asserts && !proven ? 0 : 1;
  if (asserts && !proven) reasons.push("unsupported definite-defect claim (Problem Reality is not PROVEN)");

  // 4) CTA friction: a soft CTA is good; a meeting-ask (already caught above) is bad.
  const ctaFriction = SOFT_CTA.test(i.body) ? 0 : 0.6;
  if (!SOFT_CTA.test(i.body)) reasons.push("no clear low-friction next step");

  // 5) Humanness (proxy): prohibited/filler openers hurt it.
  const humanness = 1 - Math.min(1, hits.length * 0.4);
  const specificity = (businessRef ? 0.5 : 0) + (hasObservation ? 0.5 : 0);

  const scores: CopyScores = { genericness, specificity, claimSafety, ctaFriction, humanness, leadRelevance };

  // Verdict — fail closed. Any BLOCKING failure ⇒ SUPPRESSED.
  const blocking = hits.length > 0 || fillerHit || leadRelevance === 0 || claimSafety === 0;
  if (blocking) return { verdict: "SUPPRESSED", pass: false, reasons, scores };
  // Soft weakness (no clear CTA but otherwise specific & safe) ⇒ NEEDS_ATTENTION (still no send).
  if (ctaFriction > 0) { reasons.push("weak CTA — needs a low-friction ask before sending"); return { verdict: "NEEDS_ATTENTION", pass: false, reasons, scores }; }
  reasons.push("lead-specific, claim-safe, low-friction — cleared to send");
  return { verdict: "SEND", pass: true, reasons, scores };
}

/** Short structured reason for the operator/audit (never chain-of-thought). */
export function suppressionReason(evalResult: CopyEvaluation): string {
  return `${evalResult.verdict} — ${evalResult.reasons[0] ?? "did not meet first-touch quality gate"}`;
}

/**
 * DISPATCH-boundary AUTHORITATIVE gate (last line of defense). Enforces the ESSENTIAL
 * deterministic criteria of the full evaluator — genericness (prohibited phrases AND
 * generic B2B filler), lead relevance (a THIS-business reference or specific
 * observation), and claim safety (no unsupported definite-defect claim) — so a NEWLY
 * WORDED generic email is blocked even when it avoids every banned phrase. It does NOT
 * enforce the two ADVISORY dimensions (CTA friction, humanness), which are softer
 * stylistic judgments handled at compose time / the operator UI, so terse-but-specific
 * copy is never false-positived at the wire. Fail closed on any essential failure.
 */
export function dispatchGate(i: CopyEvalInput): { block: boolean; reason: string; verdict: CopyVerdict } {
  // OUTREACH ELIGIBILITY DOCTRINE (canonical): cold first-touch is permitted ONLY when
  // Problem Reality is PROVEN. OBSERVED / NEEDS_MORE_EVIDENCE / NO_MATERIAL_PROBLEM /
  // DISPROVEN / unset are research states, never outreach — we do not contact a business
  // to find out whether it has a problem. Enforced at the WIRE, independent of UI/plan.
  const proven = (i.problemRealityStatus ?? "").toUpperCase() === "PROVEN";
  if (!proven) {
    return { block: true, reason: "SUPPRESSED — PROBLEM NOT PROVEN", verdict: "SUPPRESSED" };
  }
  const full = evaluateFirstTouchCopy(i);
  // Essential (blocking) failures: genericness / lead-relevance / claim-safety.
  const essentialFail =
    full.scores.genericness >= 0.5 || full.scores.leadRelevance === 0 || full.scores.claimSafety === 0;
  if (essentialFail) return { block: true, reason: suppressionReason(full), verdict: "SUPPRESSED" };
  // Otherwise cleared for the wire (a weak-CTA NEEDS_ATTENTION is advisory, not blocking here).
  return { block: false, reason: full.verdict === "SEND" ? "cleared" : "advisory: weak CTA (not blocking at dispatch)", verdict: full.verdict };
}

/**
 * @deprecated Narrow phrase-only guard kept for backward-compatibility. Prefer
 * dispatchGate, which also blocks lead-irrelevant / generic-filler copy. Delegates
 * to the authoritative gate.
 */
export function dispatchGuard(i: CopyEvalInput): { block: boolean; reason: string } {
  const g = dispatchGate(i);
  return { block: g.block, reason: g.reason };
}

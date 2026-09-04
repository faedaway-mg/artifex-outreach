// ─────────────────────────────────────────────────────────────────────────────
// NARRATION QUALITY + EVIDENCE-CONTRADICTION GATE. A prospect narration cannot become voiceover-ready
// unless it is (a) NOT contradicted by the captured page evidence, (b) grounded in a concrete observed
// fact with an explained business consequence and an evidence-bound recommendation, (c) free of
// unsupported revenue/conversion claims, and (d) genuinely specific — not template-equivalent to the
// generic script or another prospect's narration. Pure + fully unit-tested; returns SPECIFIC reasons.
// ─────────────────────────────────────────────────────────────────────────────

export type NarrationFailReason =
  | "contradicted_by_screenshot"
  | "insufficient_observed_detail"
  | "consequence_not_explained"
  | "recommendation_not_evidence_bound"
  | "template_equivalent"
  | "too_short"
  | "too_long"
  | "unsupported_claim";

export interface NarrationGateInput {
  narration: string[];
  finding: { key?: string | null; observation?: string | null };
  domFacts?: { ctaLabels?: string[]; primaryCta?: string | null; hasPrimaryCta?: boolean };
  peers?: Array<{ businessName?: string; lines: string[] }>;
  businessName: string;
  url?: string | null;
  reviewCount?: number | null;
}

export interface NarrationVerdict { ok: boolean; reasons: NarrationFailReason[]; wordCount: number; }

// Generic slogan lines that cannot substitute for analysis (from the mandate + observed failures).
export const GENERIC_LINES = [
  "point visitors to one clear next step",
  "put your reviews to work",
  "make the secondary paths visibly secondary",
  "make secondary paths visibly secondary",
  "your reputation is stronger than your website",
  "happy to walk you through it",
  "choose one primary action per page",
  "one clear call to action",
  "no obligation",
];

const CONSEQUENCE = /(lose|lost|losing|miss|missing|friction|confus|leav|cost|costs|drop|walk away|give up|abandon|bounce|second-guess|hesitat|call during|can'?t tell|unsure what to do|slip(s)? away|disappear|nowhere to go|many won'?t|won'?t (call|return|come back)|never (call|return)|harder to (remember|find|reach|search)|plants? a doubt|a doubt|unfinished|half-built|return visit|close(s)? the tab|the next (firm|business|shop)|has to (call|remember|wait|hunt)|quietly (cost|disappear|plant)|goes unanswered|left to (figure|guess))/i;
// Numeric / superlative business-impact claims that must be evidence-backed (we never fabricate them).
const UNSUPPORTED = /(\b\d+\s?%|\b\d+x\b|increase (your )?(revenue|conversions?|sales|traffic|leads)|boost .* by|double (your )?|triple (your )?|guarantee|\bROI\b|more revenue|drive more sales)/i;

function words(text: string): string[] { return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean); }

/** Normalize a narration to compare SUBSTANCE: strip the business name, url, review count + digits, so two
 *  scripts that differ only by those tokens are seen as interchangeable. */
function normalizeForSimilarity(text: string, ctx: { businessName?: string; url?: string | null }): string[] {
  let t = text.toLowerCase();
  if (ctx.businessName) for (const tok of ctx.businessName.toLowerCase().split(/\s+/)) if (tok.length > 2) t = t.split(tok).join(" ");
  if (ctx.url) t = t.split(ctx.url.toLowerCase()).join(" ");
  t = t.replace(/\b\d+\b/g, " ").replace(/reviews?|stars?/g, " ");
  return words(t);
}

/** Jaccard similarity over 3-word shingles — captures "same skeleton, swapped nouns". */
export function narrationSimilarity(a: string[], b: string[]): number {
  const sh = (w: string[]) => { const s = new Set<string>(); for (let i = 0; i < w.length - 2; i++) s.add(w[i] + " " + w[i + 1] + " " + w[i + 2]); return s; };
  const A = sh(a), B = sh(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// The generic template skeleton (the exact failure the mandate cited) — anything close to this fails.
const GENERIC_TEMPLATE = words("the homepage never quite tells a visitor what to do first point visitors to one clear next step choose one primary action per page and make the secondary paths visibly secondary happy to walk you through it no obligation");

function isNoCtaFinding(f: { key?: string | null; observation?: string | null }): boolean {
  const k = (f.key ?? "").toLowerCase(); const o = (f.observation ?? "").toLowerCase();
  return /noclearcta|no-clear-cta|no_clear_cta/.test(k) || /(no (clear|obvious) (call.?to.?action|primary action|next step)|isn'?t told what to do|what to do first)/.test(o);
}
function domHasCta(dom?: NarrationGateInput["domFacts"]): boolean {
  if (!dom) return false;
  if (dom.hasPrimaryCta || (dom.primaryCta && dom.primaryCta.trim().length > 0)) return true;
  return (dom.ctaLabels ?? []).some((l) => /\b(book|schedule|quote|contact|call|appointment|consult|consultation|free consultation|estimate|get started|sign up|request|reserve|apply|enroll)\b/i.test(l));
}

export function gateNarration(input: NarrationGateInput): NarrationVerdict {
  const reasons = new Set<NarrationFailReason>();
  const text = input.narration.join(" ").trim();
  const wc = words(text).length;

  // Length: ~85–130 spoken words. Allow a small margin; hard-fail well outside it.
  if (wc < 70) reasons.add("too_short");
  if (wc > 165) reasons.add("too_long");

  // Contradiction: a no-CTA finding on a page that visibly HAS a prominent action.
  if (isNoCtaFinding(input.finding) && domHasCta(input.domFacts)) reasons.add("contradicted_by_screenshot");

  // Unsupported numeric/superlative business-impact claims.
  if (UNSUPPORTED.test(text)) reasons.add("unsupported_claim");

  // Consequence must be explained (what the customer does / what the business loses).
  if (!CONSEQUENCE.test(text)) reasons.add("consequence_not_explained");

  // Observed detail: the script must carry a concrete observation, not only slogans. If ≥2 generic lines
  // OR it lacks any concrete anchor (business name / a service noun / a quoted UI label), it's too shallow.
  const lc = text.toLowerCase();
  const genericHits = GENERIC_LINES.filter((g) => lc.includes(g)).length;
  const hasConcreteAnchor = (input.businessName && lc.includes(input.businessName.toLowerCase().split(/\s+/)[0])) ||
    /"[^"]{2,40}"|homepage|booking|contact page|navigation|header|menu|form|hours|phone number|reviews page|service page|pricing|checkout/i.test(text);
  if (genericHits >= 2 || !hasConcreteAnchor) reasons.add("insufficient_observed_detail");

  // Recommendation must be evidence-bound: an improvement clause that references the observed subject.
  const hasRecommendation = /(add|introduce|surface|make|place|put|create|build|connect|streamline|simplify|show|highlight|a single|one clear|an online|a booking|a form|a call.?to.?action|a system|a workflow)/i.test(text);
  if (!hasRecommendation) reasons.add("recommendation_not_evidence_bound");

  // Template similarity: too close to the generic skeleton or a peer (name/number-stripped).
  const norm = normalizeForSimilarity(text, input);
  if (narrationSimilarity(norm, GENERIC_TEMPLATE) >= 0.5) reasons.add("template_equivalent");
  for (const peer of input.peers ?? []) {
    if (peer.businessName && peer.businessName === input.businessName) continue;
    if (narrationSimilarity(norm, normalizeForSimilarity(peer.lines.join(" "), { businessName: peer.businessName })) >= 0.6) { reasons.add("template_equivalent"); break; }
  }

  return { ok: reasons.size === 0, reasons: [...reasons], wordCount: wc };
}

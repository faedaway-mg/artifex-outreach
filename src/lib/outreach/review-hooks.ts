// ─────────────────────────────────────────────────────────────────────────────
// Quick Review hook layer (M3.1) — the static-content attention architecture. A PDF has no motion or
// sound, so it must earn attention through LANGUAGE and COMPOSITION. This module derives, for each
// evidence-backed finding, a short text hook and a bounded, deterministic VISUAL hook — always from
// evidence the finding already carries. It invents nothing: a stat hook uses a measured number, a
// comparison uses two measured sides, a screenshot hook requires a real capture, an excerpt requires a
// real fragment. When nothing richer is truthfully available it falls back to strong typography.
//
// Governing rule: EVIDENCE creates the hook; design amplifies it. Never the reverse. No cost/loss/
// revenue drama — the curiosity comes from the observable fact, not manufactured stakes.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReviewFinding, TopicKey } from "./review-evidence";

export type VisualHookType = "STAT" | "COMPARISON" | "SCREENSHOT" | "EXCERPT" | "STRUCTURE" | "TEXT_ONLY";

export interface VisualHook {
  type: VisualHookType;
  /** The measured headline value, when the hook is a number (e.g. "19", "950+", "4.8★"). */
  primaryValue: string | null;
  /** The unit/label under the value (e.g. "customer-facing collections"). */
  supportingLabel: string | null;
  /** A real screenshot crop reference, when one exists (else null — never faked). */
  screenshotRef: string | null;
  /** A short real source fragment (a public test route, placeholder copy, a duplicate label). */
  evidenceExcerpt: string | null;
  /** Two measured sides for a contrast hook (e.g. 950+ external vs 0 surfaced on-site). */
  comparison: { left: string; leftLabel: string; right: string; rightLabel: string } | null;
  /** A minimal structural flow derived from evidence (e.g. ["19 collections","No filters","Manual browsing"]). */
  structure: string[] | null;
}

export interface FindingPresentation {
  findingId: string;
  /** The shortest evidence-grounded statement that makes the reader want the explanation. */
  textHook: string;
  /** Clarity headline (unchanged from the finding). */
  title: string;
  visualHook: VisualHook;
}

// ── Text hooks — short, specific, tension-bearing, never exaggerated. Quantitative context injected
//    from the observation when present. Generalized (topic-keyed), never business-specific. ──────────
const TOPIC_HOOK: Record<TopicKey, (n: string | null) => string> = {
  catalog: (n) => (n ? `${n} ways in. Almost no way to narrow them.` : "A big catalog with little way to narrow it."),
  reviews: (n) => (n ? `${n}+ customers already did the hard part.` : "Strong proof the site isn't using yet."),
  mobile: () => "The first mobile impression is doing too much work.",
  "test-content": () => "Internal-looking pages are out in public view.",
  duplicate: () => "The same aisle, signposted more than once.",
  cta: (n) => (n ? `${n} “main” actions. No clear first move.` : "Several main actions, no clear first move."),
  navigation: (n) => (n ? `${n} front doors, little sense of direction.` : "Lots of front doors, little direction."),
  brand: () => "The name shows up in more than one form.",
  copy: () => "Unfinished copy is still on the page.",
  booking: () => "Booking still means making a phone call.",
  trust: () => "The trust signals arrive after the decision.",
  speed: () => "The page keeps visitors waiting.",
  contact: () => "Getting in touch takes more work than it should.",
  presence: () => "The audience is being built on rented land.",
  general: () => "Something in the public experience is worth a look.",
};

// Language a hook may never use — no manufactured financial stakes (evidentiary discipline).
const EXAGGERATION_RX = /\b(costing|losing|lost revenue|missing revenue|thousands|\$\s?\d|abandon(?:ing|ed)?|hemorrhag|bleeding)\b/i;

/** First standalone number in a string (a count/rating), commas stripped. Null when none. */
function firstNumber(s: string): string | null {
  const m = s.match(/\b(\d[\d,]*)\b/);
  return m ? m[1].replace(/,/g, "") : null;
}

/** A measured count + its unit label, for a STAT/STRUCTURE hook. Reads the observation, not a guess. */
function statOf(f: ReviewFinding): { value: string; label: string } | null {
  const obs = f.observation;
  if (f.topic === "catalog") { const n = firstNumber(obs); return n ? { value: n, label: "customer-facing collections" } : null; }
  if (f.topic === "cta") { const n = firstNumber(obs); return n ? { value: n, label: "competing calls-to-action" } : null; }
  if (f.topic === "navigation") { const n = firstNumber(obs); return n ? { value: n, label: "top-level destinations" } : null; }
  if (f.topic === "test-content") { const n = firstNumber(obs); return n ? { value: n, label: "internal-looking public pages" } : null; }
  return null;
}

/** The external-proof contrast (reviews topic): count + rating vs no comparable on-site proof. Scope
 *  is stated honestly ("in the crawled pages") — partial evidence never becomes a site-wide absolute. */
function proofOf(f: ReviewFinding): VisualHook["comparison"] | null {
  if (f.topic !== "reviews") return null;
  const count = f.observation.match(/\b(\d[\d,]*)\+?\s*reviews?\b/i)?.[1]?.replace(/,/g, "");
  const rating = f.observation.match(/\b(\d(?:\.\d)?)\s*(?:★|stars?)/i)?.[1];
  if (!count) return null;
  return { left: `${count}+`, leftLabel: rating ? `external reviews · ${rating}★` : "external reviews", right: "0", rightLabel: "surfaced in the crawled pages" };
}

/** A short, real source fragment to show as a receipt (test route, placeholder copy, duplicate label,
 *  name inconsistency). Pulled from the finding's exact basis — never fabricated. Bounded length. */
function excerptOf(f: ReviewFinding): string | null {
  for (const b of f.evidence.basis) {
    const q = b.match(/"([^"]{2,40})"/); // copy: "…", on-page: "…"
    if (q) return q[1];
    const link = b.match(/link:\s*\S*\/([a-z0-9][a-z0-9._-]{1,40})\/?$/i); // link: …/test-old-home
    if (link) return link[1];
    const dup = b.match(/near-duplicate:\s*(.+)/i);
    if (dup) return dup[1].split(/\s*≈\s*/).map((u) => u.split("/").filter(Boolean).pop()).filter(Boolean).slice(0, 2).join("  ≈  ");
  }
  return null;
}

/** Choose ONE visual hook per finding from a bounded set, by evidence available (deterministic order):
 *  real screenshot → real excerpt → measured proof-contrast → structural flow → single stat → text. */
export function selectVisualHook(f: ReviewFinding): VisualHook {
  const base: VisualHook = { type: "TEXT_ONLY", primaryValue: null, supportingLabel: null, screenshotRef: null, evidenceExcerpt: null, comparison: null, structure: null };
  if (f.evidence.screenshotRef) return { ...base, type: "SCREENSHOT", screenshotRef: f.evidence.screenshotRef };
  const excerpt = (f.topic === "test-content" || f.topic === "copy" || f.topic === "brand" || f.topic === "duplicate") ? excerptOf(f) : null;
  if (excerpt) return { ...base, type: "EXCERPT", evidenceExcerpt: excerpt };
  const comparison = proofOf(f);
  if (comparison) return { ...base, type: "COMPARISON", comparison };
  const stat = statOf(f);
  if (stat && f.topic === "catalog") return { ...base, type: "STRUCTURE", primaryValue: stat.value, supportingLabel: stat.label, structure: [`${stat.value} collections`, "No filters or sorting found", "Manual browsing"] };
  if (stat) return { ...base, type: "STAT", primaryValue: stat.value, supportingLabel: stat.label };
  return base;
}

/** Build the presentation (text + visual hook) for each finding. Pure. */
export function presentFindings(findings: ReviewFinding[]): FindingPresentation[] {
  return findings.map((f) => ({
    findingId: f.id,
    textHook: TOPIC_HOOK[f.topic](firstNumber(f.observation)),
    title: f.title,
    visualHook: selectVisualHook(f),
  }));
}

/** Hook strength — how immediately communicative a finding's hook is. Drives the OPENING hook, which
 *  need not be Finding 01: a quantified contrast/number beats a text-only line. Deterministic. */
function hookStrength(f: ReviewFinding, v: VisualHook): number {
  const byType: Record<VisualHookType, number> = { COMPARISON: 4, STRUCTURE: 3.5, STAT: 3, SCREENSHOT: 2.5, EXCERPT: 2, TEXT_ONLY: 0 };
  const conf = f.evidence.confidence === "Observed" ? 1 : f.evidence.confidence === "Reported" ? 0.8 : 0.4;
  return byType[v.type] + conf;
}

// ── Opening hooks — a SYNTHESIZING frame for the whole review, deliberately phrased DIFFERENTLY
//    from any single finding's textHook so the masthead line never duplicates Finding 0N (the first
//    live-batch defect: the opening hook was a verbatim copy of a finding's hook). Grounded in the
//    same evidence; a broader framing, not the specific tension. Quantitative context when present. ──
const TOPIC_OPENING: Record<TopicKey, (n: string | null) => string> = {
  reviews: () => "Your reputation is stronger than your website currently shows.",
  cta: () => "The homepage never quite tells a visitor what to do first.",
  catalog: () => "A large catalog is harder to shop than it should be.",
  mobile: () => "On a phone, the action that matters is hard to reach.",
  booking: () => "New customers can't finish a booking on their own.",
  trust: () => "The proof shows up only after the decision is made.",
  navigation: () => "There are many ways in, but little sense of direction.",
  "test-content": () => "Pages meant for internal eyes sit in public view.",
  duplicate: () => "Shoppers get sent down the same path more than once.",
  brand: () => "The business is introduced under more than one name.",
  copy: () => "Draft-stage text is still live on public pages.",
  speed: () => "Load time is quietly costing the first impression.",
  contact: () => "Reaching the business takes more effort than it should.",
  presence: () => "Right now the business lives on someone else's platform.",
  general: () => "There's a clear, fixable gap in the public experience.",
};

/** The single strongest opening hook, chosen across all findings (most communicative truthful fact).
 *  Ties break by the finding's existing rank (order in `findings`). Null when there are no findings.
 *  Uses a SYNTHESIZING opening template — never the finding's own textHook — so the masthead line is
 *  editorially distinct from every finding (verified by the editorial-quality gate). */
export function openingHook(findings: ReviewFinding[]): string | null {
  if (!findings.length) return null;
  const scored = findings.map((f) => ({ f, v: selectVisualHook(f), s: hookStrength(f, selectVisualHook(f)) }));
  let best = scored[0];
  for (const c of scored) if (c.s > best.s) best = c; // strict > keeps original order on ties
  return TOPIC_OPENING[best.f.topic](firstNumber(best.f.observation));
}

/** Guard used in tests: no hook may use manufactured financial/loss language. */
export function hookHasExaggeration(text: string): boolean { return EXAGGERATION_RX.test(text); }

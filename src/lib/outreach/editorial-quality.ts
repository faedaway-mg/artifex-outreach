// ─────────────────────────────────────────────────────────────────────────────
// Editorial-quality gate for the Quick Review (Phase 4).
//
// "Delivery ready" must mean EDITORIALLY ready, not merely rendered. This is a
// DETERMINISTIC check for avoidable redundancy across the customer-facing surfaces
// of a review — the failure mode observed on the first live batch (the main hook
// was a verbatim copy of a finding's hook; "Where we'd start" restated a finding).
//
// It is NOT an exact-string check. It normalizes text, MASKS the entities that are
// legitimately shared (numbers, the business domain, the business name, single
// evidence terms), then compares masked token sets with the Sørensen–Dice
// coefficient against explicit thresholds. Shared metrics/domains/names therefore
// never create a false block; only avoidable *editorial* duplication is flagged.
//
// Pure. No I/O. Repetition required for factual accuracy is separated from
// avoidable duplication (see EVIDENCE roles, which are compared only to each other).
// ─────────────────────────────────────────────────────────────────────────────

export type EditorialSeverity = "block" | "warn";
export type EditorialRole = "hook" | "title" | "body" | "action" | "evidence" | "proof";

export interface EditorialSegment {
  /** A human-facing section id, e.g. "main-hook", "finding-1", "where-we-start". */
  section: string;
  role: EditorialRole;
  text: string;
}

export interface EditorialIssue {
  code:
    | "exact-repeat"
    | "hook-copies-finding"
    | "duplicate-title"
    | "restated-body"
    | "similar-body"
    | "recommendation-restates-finding"
    | "repeated-evidence"
    | "placeholder-language";
  severity: EditorialSeverity;
  a: string; // section:role of the first segment
  b: string; // section:role of the second segment (or "" for single-segment issues)
  detail: string;
  similarity: number; // 0..1 (1 for exact / single-segment rules)
}

export interface EditorialCheckOptions {
  /** Terms that are legitimately shared and must never, alone, trigger a flag:
   *  the business name, its domain labels. Numbers and single evidence terms are masked too. */
  allowTerms?: string[];
}

// Explicit, tuned thresholds (Sørensen–Dice on masked token sets).
export const THRESHOLDS = {
  HOOK_COPIES_FINDING: 0.85, // main hook ≈ a finding's hook/title
  DUPLICATE_TITLE: 0.8, // two finding titles nearly identical
  BODY_BLOCK: 0.7, // two bodies/whys in different sections restate each other (symmetric Dice)
  BODY_WARN: 0.55, // lower-severity echo
  CONTAINMENT_BLOCK: 0.85, // one body's distinctive content is almost wholly inside another (restatement + filler)
} as const;

// TRUE placeholders / template stubs only — never legitimate soft prose (which the similarity
// rules handle). Over-broad phrase matching here would false-block real copy.
const PLACEHOLDER_RX =
  /(\blorem ipsum\b|\btodo\b|\btbd\b|\bxxx+\b|\bplaceholder\b|\{\{[^}]*\}\}|\[[a-z][a-z ]+\]|\binsert [a-z]+ here\b|\byour [a-z]+ here\b)/i;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "is", "are",
  "it", "its", "your", "you", "we", "wed", "they", "their", "this", "that", "so", "as", "by",
]);

/** Lowercase, strip punctuation/quotes, collapse whitespace. Deterministic. */
export function normalizeText(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens with legitimately-shared ENTITIES masked out: numbers → dropped, and any allow-term
 *  token (business name / domain label) removed, plus stopwords removed. What remains is the
 *  distinctive editorial content — the only thing avoidable duplication can live in. */
function contentTokens(text: string, allow: Set<string>): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t && !/^\d+$/.test(t) && !allow.has(t) && !STOPWORDS.has(t));
}

function intersectionSize(A: Set<string>, B: Set<string>): number {
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter;
}

/** Sørensen–Dice coefficient over token SETS (0..1). */
export function diceSimilarity(aTokens: string[], bTokens: string[]): number {
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  if (A.size === 0 || B.size === 0) return 0;
  return (2 * intersectionSize(A, B)) / (A.size + B.size);
}

/** Asymmetric CONTAINMENT (0..1): the max fraction of EITHER set's distinctive tokens found in the
 *  other. Catches "restatement + filler" — e.g. a recommendation that repeats a finding's whole
 *  sentence and then adds boilerplate (which dilutes symmetric Dice below threshold). */
export function containment(aTokens: string[], bTokens: string[]): number {
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  if (A.size === 0 || B.size === 0) return 0;
  const inter = intersectionSize(A, B);
  return Math.max(inter / A.size, inter / B.size);
}

function allowSet(opts: EditorialCheckOptions): Set<string> {
  const s = new Set<string>();
  for (const term of opts.allowTerms ?? []) {
    for (const tok of normalizeText(term).split(" ")) if (tok) s.add(tok);
  }
  return s;
}

const label = (seg: EditorialSegment) => `${seg.section}:${seg.role}`;

/**
 * The deterministic editorial-redundancy check. Returns every issue found (empty = clean).
 * High-severity ("block") issues must prevent DELIVERY_READY; "warn" issues are advisory.
 */
export function checkEditorialRedundancy(segments: EditorialSegment[], opts: EditorialCheckOptions = {}): EditorialIssue[] {
  const allow = allowSet(opts);
  const issues: EditorialIssue[] = [];
  const tok = segments.map((s) => contentTokens(s.text, allow));
  const norm = segments.map((s) => normalizeText(s.text));

  // 1) Placeholder / generic language that escaped generation (single-segment).
  segments.forEach((s) => {
    if (PLACEHOLDER_RX.test(s.text)) {
      issues.push({ code: "placeholder-language", severity: "block", a: label(s), b: "", detail: `generic/placeholder language: "${s.text.slice(0, 60)}"`, similarity: 1 });
    }
  });

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const A = segments[i];
      const B = segments[j];
      if (A.section === B.section) continue; // within one finding, roles are intentionally distinct
      const ti = tok[i];
      const tj = tok[j];
      // Metric-only / near-empty content after masking → legitimately shared entity, never a flag.
      if (ti.length < 3 || tj.length < 3) continue;
      const sim = diceSimilarity(ti, tj);
      const exact = norm[i] === norm[j] || (ti.join(" ") === tj.join(" "));

      // 2) Exact repeated sentence across sections.
      if (exact) {
        issues.push({ code: "exact-repeat", severity: "block", a: label(A), b: label(B), detail: "identical customer-facing text in two sections", similarity: 1 });
        continue;
      }
      // 3) Main hook copies a finding's hook or title.
      if (A.role === "hook" || B.role === "hook") {
        const other = A.role === "hook" ? B : A;
        if ((other.role === "hook" || other.role === "title" || other.role === "body") && sim >= THRESHOLDS.HOOK_COPIES_FINDING) {
          issues.push({ code: "hook-copies-finding", severity: "block", a: label(A), b: label(B), detail: `the hook duplicates ${other.role} of ${other.section} (sim ${sim.toFixed(2)})`, similarity: sim });
          continue;
        }
      }
      // 4) Duplicate/near-duplicate finding titles.
      if (A.role === "title" && B.role === "title" && sim >= THRESHOLDS.DUPLICATE_TITLE) {
        issues.push({ code: "duplicate-title", severity: "block", a: label(A), b: label(B), detail: `near-identical titles (sim ${sim.toFixed(2)})`, similarity: sim });
        continue;
      }
      // 5) Bodies/whys restating each other across sections.
      const bodyRoles = new Set<EditorialRole>(["body", "action"]);
      if (bodyRoles.has(A.role) && bodyRoles.has(B.role)) {
        const contain = containment(ti, tj);
        if (sim >= THRESHOLDS.BODY_BLOCK || contain >= THRESHOLDS.CONTAINMENT_BLOCK) {
          // A recommendation ("where-we-start") that merely restates a finding is a distinct, named issue.
          const isRec = A.section.includes("start") || B.section.includes("start");
          const eff = Math.max(sim, contain);
          issues.push(
            isRec
              ? { code: "recommendation-restates-finding", severity: "block", a: label(A), b: label(B), detail: `the recommendation restates a finding without advancing to a new action (overlap ${eff.toFixed(2)})`, similarity: eff }
              : { code: "restated-body", severity: "block", a: label(A), b: label(B), detail: `two sections say nearly the same thing (overlap ${eff.toFixed(2)})`, similarity: eff },
          );
          continue;
        }
        if (sim >= THRESHOLDS.BODY_WARN) {
          issues.push({ code: "similar-body", severity: "warn", a: label(A), b: label(B), detail: `noticeable echo between sections (sim ${sim.toFixed(2)})`, similarity: sim });
          continue;
        }
      }
      // 6) Repeated evidence/proof lines that add no new meaning.
      if ((A.role === "evidence" || A.role === "proof") && (B.role === "evidence" || B.role === "proof") && (exact || sim >= THRESHOLDS.BODY_BLOCK)) {
        issues.push({ code: "repeated-evidence", severity: "warn", a: label(A), b: label(B), detail: "an evidence/proof line repeats another without adding meaning", similarity: sim });
      }
    }
  }
  return issues;
}

/** True when nothing BLOCKS delivery (warnings are allowed through with operator judgement). */
export function editorialBlocks(issues: EditorialIssue[]): EditorialIssue[] {
  return issues.filter((i) => i.severity === "block");
}

// ── Adapters: pull the customer-facing surface out of an assembled review ────────
export interface ReviewLike {
  businessName?: string;
  website?: string | null;
  industryLabel?: string;
  openingHook: string | null;
  findings: Array<{ id: string; title: string; whyItMatters: string; whatWedDo: string; evidence?: { displayLabel?: string | null } }>;
  presentations?: Array<{ findingId: string; textHook: string }>;
  start: { label: string; why: string; proofReference?: string | null } | null;
  /** Optional closing/proof footer line, when the template shows one. */
  closingLine?: string | null;
}

/** Terms legitimately shared across the whole document — the business name + domain labels. */
export function allowTermsFor(r: Pick<ReviewLike, "businessName" | "website">): string[] {
  const terms: string[] = [];
  if (r.businessName) terms.push(r.businessName);
  if (r.website) {
    const host = r.website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0];
    for (const lbl of host.split(".")) if (lbl) terms.push(lbl);
  }
  return terms;
}

/** Extract every customer-facing segment from an assembled review, in stable order. */
export function reviewEditorialSurface(r: ReviewLike): EditorialSegment[] {
  const segs: EditorialSegment[] = [];
  if (r.openingHook) segs.push({ section: "main-hook", role: "hook", text: r.openingHook });
  const hookById = new Map((r.presentations ?? []).map((p) => [p.findingId, p.textHook]));
  r.findings.forEach((f, i) => {
    const sec = `finding-${i + 1}`;
    if (f.title) segs.push({ section: sec, role: "title", text: f.title });
    const h = hookById.get(f.id);
    if (h) segs.push({ section: sec, role: "hook", text: h });
    if (f.whyItMatters) segs.push({ section: sec, role: "body", text: f.whyItMatters });
    if (f.whatWedDo) segs.push({ section: sec, role: "action", text: f.whatWedDo });
    if (f.evidence?.displayLabel) segs.push({ section: sec, role: "evidence", text: f.evidence.displayLabel });
  });
  if (r.start) {
    if (r.start.label) segs.push({ section: "where-we-start", role: "title", text: r.start.label });
    if (r.start.why) segs.push({ section: "where-we-start", role: "body", text: r.start.why });
    if (r.start.proofReference) segs.push({ section: "where-we-start", role: "proof", text: r.start.proofReference });
  }
  if (r.closingLine) segs.push({ section: "closing", role: "proof", text: r.closingLine });
  return segs;
}

/** One-call gate: extract the surface and check it, masking the business name + domain. */
export function checkReview(r: ReviewLike): EditorialIssue[] {
  return checkEditorialRedundancy(reviewEditorialSurface(r), { allowTerms: allowTermsFor(r) });
}

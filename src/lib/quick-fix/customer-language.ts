// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER-LANGUAGE QA GATE — the "no-jargon" rule.
//
// A business owner reading our customer-facing copy is NOT a developer or a
// marketer. If the primary copy an owner sees leans on unexplained acronyms
// (CTA, CRO, GA4, WCAG…), internal SKU keys (`cta-repair`), or developer/marketing
// jargon, the offer reads like it was written for someone else — and it should NOT
// be cold-send eligible. Operators keep every technical term they like INTERNALLY;
// this gate only ever inspects CUSTOMER-facing surfaces.
//
// This mirrors the shape of outbound-quality.ts (pattern lists +
// assess*(): { passes, problems }) and REUSES the fabrication guard from
// evidence-gate.ts. It NEVER rewrites copy — a plain-language translation is the
// operator's job and must not change factual SCOPE; the gate only reports.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";

export interface CustomerLanguageResult {
  passes: boolean;
  problems: string[];
}

// ── Allowlist ────────────────────────────────────────────────────────────────
// Terms a NORMAL business owner truly recognizes with no expansion. Deliberately
// small and conservative: we do NOT assume an acronym is common just because
// Artifex (or the tech industry) uses it constantly. "URL", "PDF", "FAQ" and
// "email" are genuinely everyday; "SEO"/"CTA"/"API" are NOT and must be earned by
// expansion on first use.
export const CUSTOMER_ALLOWLIST: readonly string[] = [
  "URL", "PDF", "FAQ", "USA", "US", "USD", "AM", "PM", "TV", "ID", "OK", "DIY", "Q&A",
] as const;

// ── Gated acronyms ───────────────────────────────────────────────────────────
// Technical / developer / marketing acronyms that a normal owner does NOT reliably
// know. Each is fine in customer copy ONLY IF its expansion appears (on first use).
// e.g. "call-to-action (CTA)" or "CTA (the button visitors click)" passes;
// a bare "CTA" does not. Expansion detection is handled below.
export const GATED_ACRONYMS: readonly string[] = [
  "CTA", "CRO", "CMS", "UX", "UI", "GA4", "GTM", "SEO", "DNS", "WCAG", "API",
] as const;

// Human-readable expansions we accept as "explained" when they co-occur with the
// acronym (case-insensitive substring, punctuation-flexible). This is not the only
// way to explain — any parenthetical/gloss near the acronym also counts (see below).
const ACRONYM_EXPANSIONS: Record<string, RegExp[]> = {
  CTA: [/call[\s-]?to[\s-]?action/i, /\bbutton\b/i],
  CRO: [/conversion[\s-]?rate[\s-]?optimi[sz]ation/i],
  CMS: [/content[\s-]?management[\s-]?system/i, /website (editor|platform|builder)/i],
  UX: [/user[\s-]?experience/i],
  UI: [/user[\s-]?interface/i],
  GA4: [/google[\s-]?analytics/i],
  GTM: [/google[\s-]?tag[\s-]?manager/i, /tag[\s-]?manager/i],
  SEO: [/search[\s-]?engine[\s-]?optimi[sz]ation/i, /search (listing|ranking|results?)/i],
  DNS: [/domain[\s-]?name[\s-]?system/i, /domain settings/i],
  WCAG: [/web content accessibility guidelines/i, /accessibility (standard|guideline)/i],
  API: [/application[\s-]?programming[\s-]?interface/i],
};

// ── Internal SKU / capability keys ───────────────────────────────────────────
// Machine keys from the capability registry (kebab-case) that must NEVER surface in
// customer text — the owner sees `customerTitle`, not `cta-repair`. Detected
// generically (a kebab-case token that reads like an internal key), not by a
// hard-coded list, so new SKUs are covered without edits.
const INTERNAL_KEY_PATTERN = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+){1,}\b/g;
// Everyday hyphenated words that are NOT internal keys — never flag these.
const KEBAB_ALLOWLIST = new Set<string>([
  "call-to-action", "e-commerce", "long-term", "up-to-date", "one-time", "above-the-fold",
  "one-page", "easier-to-read",
  "mobile-friendly", "easy-to-read", "double-check", "follow-up", "sign-up", "opt-in",
  "opt-out", "add-on", "day-to-day", "step-by-step", "real-time", "user-friendly",
  "self-service", "so-called", "well-known", "high-quality", "in-depth", "on-site",
]);

// ── Developer / marketing jargon (whole-word) ────────────────────────────────
// Words that read as internal engineering/marketing vocabulary, not owner language.
const JARGON_PATTERNS: RegExp[] = [
  /\bviewport\b/i,
  /\bresponsive breakpoints?\b/i,
  /\bschema markup\b/i,
  /\bmeta ?tags?\b/i,
  /\bmetadata\b/i,
  /\bfunnel\b/i,
  /\bconversion funnel\b/i,
  /\bleverage\b/i,
  /\bsynerg(y|ies|istic)\b/i,
  /\bidea(te|tion)\b/i,
  /\bomni[\s-]?channel\b/i,
  /\bcta[\s-]?repair\b/i, // internal capability name style
  /\bDOM\b/,
  /\bviewport meta\b/i,
  /\bhero (unit|section) markup\b/i,
  /\brefactor(ing)?\b/i,
  /\bmiddleware\b/i,
  /\bwebhooks?\b/i,
];

// ── Vague phrases that don't describe the actual customer action ─────────────
// The primary "next action" copy must name a concrete thing the owner does; these
// hedges never do.
const VAGUE_ACTION_PATTERNS: RegExp[] = [
  /\bcircle back\b/i,
  /\btouch base\b/i,
  /\bsynergize\b/i,
  /\breach out to (learn|explore|discuss)\b/i,
  /\blet'?s connect\b/i,
  /\bexplore (options|opportunities|possibilities)\b/i,
  /\bunlock (value|potential|growth)\b/i,
  /\btake it to the next level\b/i,
];

function wordBoundaryRegex(term: string): RegExp {
  // GA4 ends in a digit so \b after "4" works; alnum tokens use \b on both sides.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`);
}

/** True when `acronym` appears AND is explained somewhere in the text (expansion
 *  phrase present, OR a parenthetical gloss adjacent to the acronym). */
function acronymIsExplained(acronym: string, text: string): boolean {
  const expansions = ACRONYM_EXPANSIONS[acronym] ?? [];
  if (expansions.some((re) => re.test(text))) return true;
  // A parenthetical adjacent to the acronym also counts as an explanation:
  //   "CTA (the button visitors click)" or "(CTA)" following a spelled-out phrase.
  const esc = acronym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const adjacentParen = new RegExp(`${esc}\\s*\\([^)]{3,}\\)|\\([^)]*${esc}[^)]*\\)`, "i");
  if (adjacentParen.test(text)) {
    // "(CTA)" alone (just the bare acronym in parens) is NOT an explanation.
    const bareInParen = new RegExp(`\\(\\s*${esc}\\s*\\)`, "i");
    // If the ONLY paren match is the bare acronym, don't count it as explained.
    const onlyBare = bareInParen.test(text) && !new RegExp(`${esc}\\s*\\([^)]{3,}\\)`, "i").test(text)
      && !new RegExp(`\\([^)]*[A-Za-z]{4,}[^)]*${esc}[^)]*\\)`, "i").test(text);
    return !onlyBare;
  }
  return false;
}

/**
 * Assess a single piece of CUSTOMER-facing text for jargon / unexplained acronyms /
 * internal keys / vague non-actions. Pure + deterministic. Never rewrites text.
 */
export function assessCustomerLanguage(text: string): CustomerLanguageResult {
  const problems: string[] = [];
  const t = text ?? "";

  // 1) Unexplained gated acronyms.
  for (const acronym of GATED_ACRONYMS) {
    if (CUSTOMER_ALLOWLIST.includes(acronym)) continue; // never (kept for safety)
    if (wordBoundaryRegex(acronym).test(t) && !acronymIsExplained(acronym, t)) {
      problems.push(`unexplained acronym "${acronym}" in customer-facing copy — expand or translate on first use`);
    }
  }

  // 2) Internal SKU / capability keys (kebab-case machine keys).
  const keyMatches = t.toLowerCase().match(INTERNAL_KEY_PATTERN) ?? [];
  for (const raw of new Set(keyMatches)) {
    if (KEBAB_ALLOWLIST.has(raw)) continue;
    problems.push(`internal key "${raw}" must not appear in customer text — use the plain-language title`);
  }

  // 3) Developer / marketing jargon.
  for (const re of JARGON_PATTERNS) {
    const m = t.match(re);
    if (m) problems.push(`developer/marketing jargon "${m[0]}" — use plain owner language`);
  }

  // 4) Vague phrases that don't describe a real customer action.
  for (const re of VAGUE_ACTION_PATTERNS) {
    const m = t.match(re);
    if (m) problems.push(`vague phrase "${m[0].trim()}" — say the concrete action the owner takes`);
  }

  return { passes: problems.length === 0, problems: dedupe(problems) };
}

// ── Offer-surface scanner ────────────────────────────────────────────────────
// Every string an owner can actually read for THIS offer. Internal fields
// (economics, rationale [operator-facing], capability `.name`) are deliberately
// EXCLUDED — operators keep their technical vocabulary. Optional extra surfaces let
// the same gate cover derived customer artifacts (video narration, diagnostic PDF
// text, delivery/completion report) without this module importing those generators.
export interface CustomerFacingSurfaces {
  /** Video narration script read aloud to the customer. */
  videoNarration?: string | null;
  /** Text rendered into the customer-facing diagnostic PDF. */
  pdfText?: string | null;
  /** The delivery / completion report the customer receives. */
  completionReport?: string | null;
  /** Any other explicitly customer-facing strings. */
  extra?: Array<string | null | undefined>;
}

/** Collect the customer-facing surfaces of an offer's SCOPE (+ maintenance copy). */
export function offerCustomerSurfaces(offer: QuickFixOffer): Array<{ where: string; text: string }> {
  const s = offer.scope;
  const rows: Array<{ where: string; text: string }> = [
    { where: "scope.offerName", text: s.offerName ?? "" },
    { where: "scope.problemBeingSolved", text: s.problemBeingSolved ?? "" },
    { where: "scope.proposedSolution", text: s.proposedSolution ?? "" },
    ...(s.includedItems ?? []).map((x, i) => ({ where: `scope.includedItems[${i}]`, text: x })),
    ...(s.excludedItems ?? []).map((x, i) => ({ where: `scope.excludedItems[${i}]`, text: x })),
    ...(s.customerInputsRequired ?? []).map((x, i) => ({ where: `scope.customerInputsRequired[${i}]`, text: x })),
    { where: "scope.deliveryWindow", text: s.deliveryWindow ?? "" },
    { where: "scope.revisionPolicy", text: s.revisionPolicy ?? "" },
  ];
  if (offer.maintenance) {
    rows.push({ where: "maintenance.planName", text: offer.maintenance.planName ?? "" });
    rows.push({ where: "maintenance.rationale", text: offer.maintenance.rationale ?? "" });
  }
  return rows.filter((r) => r.text.trim().length > 0);
}

/**
 * Scan an offer's customer-facing copy (scope + maintenance) plus any supplied
 * derived surfaces (narration / PDF / completion report). Returns per-surface
 * problems so the operator can see WHERE the jargon leaked. `passes` is true only
 * when EVERY customer-facing surface is clean. Read-only.
 */
export function assessOfferCustomerLanguage(
  offer: QuickFixOffer,
  surfaces: CustomerFacingSurfaces = {},
): CustomerLanguageResult {
  const rows = offerCustomerSurfaces(offer);
  if (surfaces.videoNarration) rows.push({ where: "videoNarration", text: surfaces.videoNarration });
  if (surfaces.pdfText) rows.push({ where: "pdfText", text: surfaces.pdfText });
  if (surfaces.completionReport) rows.push({ where: "completionReport", text: surfaces.completionReport });
  for (const [i, x] of (surfaces.extra ?? []).entries()) {
    if (x && x.trim()) rows.push({ where: `extra[${i}]`, text: x });
  }

  const problems: string[] = [];
  for (const row of rows) {
    const r = assessCustomerLanguage(row.text);
    for (const p of r.problems) problems.push(`[${row.where}] ${p}`);
  }
  return { passes: problems.length === 0, problems: dedupe(problems) };
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

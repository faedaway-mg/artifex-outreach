// ─────────────────────────────────────────────────────────────────────────────
// CURIOSITY-FIRST SUBJECT ENGINE (SUPERSEDES all prior Quick-Cash subject logic).
//
// A first-touch email subject earns the open through BREVITY, not deception. It is
// derived from the SAME real, evidence-graded defect the offer is built on — never
// invented, never a fake premise, never a promo. The engine walks:
//
//     observed defect  →  customer-recognizable surface  →  concise operational noun phrase
//
// Output is deliberately tiny: 1–3 words (4 only when unavoidable), lowercase,
// inbox-native (no caps, emoji, "!", or promo punctuation). Curiosity comes from a
// human seeing a plain, true, specific phrase in their inbox — "website inquiry" —
// with no idea yet what it's about, and NOT from a manufactured "RE:" or "your
// missed appointment". We would rather under-claim than manufacture urgency.
//
// It returns EXACTLY THREE candidates, in a fixed role order so selection is
// deterministic and auditable:
//     (1) the operational TOPIC          — the thing itself      (primary)
//     (2) the affected customer ACTION   — what a visitor tries to do
//     (3) the affected SURFACE           — where it lives
//
// The primary is candidate (1). It is chosen deterministically from the mapped
// family; nothing here is random or model-generated at request time.
// ─────────────────────────────────────────────────────────────────────────────

/** Bump when the FORBIDDEN set, the family mappings, or the selection rule change.
 *  Every generated/selected subject is stamped with this so downstream conversion
 *  can be attributed to the exact policy that produced it. */
export const SUBJECT_POLICY_VERSION = "subject.v1";

/** The evidence-derived defect family. Each maps to a single deterministic triple. */
export type SubjectFamily =
  | "contact"
  | "booking"
  | "mobile_booking"
  | "mobile_contact"
  | "readability"
  | "search"
  | "analytics"
  | "generic";

/** The coarse defect type carried into tracking (the observed-problem class). */
export type SubjectDefectType = SubjectFamily;

export interface SubjectCandidates {
  /** The chosen first-touch subject (deterministically candidate #1 of the family). */
  primary: string;
  /** The other two candidates the operator may select instead. Always length 2. */
  alternates: string[];
  /** The mapped defect family (also the tracked defectType). */
  family: SubjectFamily;
  /** Policy stamp — freeze onto the record so conversion attributes to this version. */
  policyVersion: string;
  /** Coarse observed-defect class for tracking (== family). */
  defectType: SubjectDefectType;
}

export interface SubjectInput {
  /** The evidence-graded problem/observation text the offer is built on. REQUIRED —
   *  the subject is DERIVED from this, so we can only map a family that this supports. */
  observation: string;
  /** Optional extra evidence text (whyItMatters / proposedSolution) to disambiguate. */
  context?: string;
  /** Optional BI category, used only as a weak tiebreak — never as sole evidence. */
  category?: string;
  /** Company name — used ONLY if includeCompany is explicitly true (default OFF). */
  companyName?: string;
  /** Default OFF. First-touch subjects never carry the company name. */
  includeCompany?: boolean;
}

// ── FORBIDDEN vocabulary in a default first-touch subject ─────────────────────────
// Anything that would make the subject a promo, a fake premise, a jargon dump, or a
// self-reference. A subject that trips any of these is REJECTED (never emitted).
const FORBIDDEN_WORDS: RegExp = new RegExp(
  [
    "artifex",
    "quick[-\\s]?fix",
    "repair",
    "audit",
    "diagnostic",
    "\\bai\\b",
    "free",
    "discount",
    "24[-\\s]?hour",
    "consultation",
    "offer",
    "quote",
    // CTA / acronyms (translate to a plain topic; never leave the acronym in)
    "\\bcta\\b",
    "\\bseo\\b",
    "\\bgbp\\b",
    "\\bppc\\b",
    "\\bcrm\\b",
    // fake urgency / manufactured premises
    "urgent",
    "immediately",
    "act now",
    "last chance",
    "explimit",
  ].join("|"),
  "i",
);

// False PREMISES — a subject implying an event that did not actually happen. These
// are always forbidden in a cold first-touch (we have no such event on record).
const FALSE_PREMISE: RegExp =
  /\bnew customer inquiry\b|\bbooking request\b|\bmissed appointment\b|\bpayment issue\b|\bcustomer complaint\b|^\s*re:|^\s*fwd:/i;

// Promo / non-inbox-native punctuation and shapes.
const PROMO_PUNCT: RegExp = /[!$%•★→›»*]|[A-Z]{2,}|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/** A subject is emitting-safe iff it is short, lowercase, inbox-native, and clean. */
export function isPolicyCompliantSubject(subject: string): boolean {
  const s = subject.trim();
  if (!s) return false;
  if (s !== s.toLowerCase()) return false; // lowercase only (also blocks caps/RE:)
  if (PROMO_PUNCT.test(s)) return false;
  if (/[!?]/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;
  if (FORBIDDEN_WORDS.test(s)) return false;
  if (FALSE_PREMISE.test(s)) return false;
  // No price / money.
  if (/\$|\bdollars?\b|\bcents?\b|\b\d+\s?(usd)\b/i.test(s)) return false;
  return true;
}

// ── The deterministic family → triple mappings ──────────────────────────────────
// Order of each triple is ALWAYS [topic, action, surface]. The topic is the primary.
// BUSINESS-JOURNEY language (Problem-Reality amendment §16–§18): a subject should feel
// like a natural attempt to interact with the BUSINESS (booking / appointment / contact),
// NOT generic web-sales framing. We deliberately RETIRED "website note / website inquiry /
// website review" — those instantly read as website-sales spam.
const FAMILY_TRIPLES: Record<Exclude<SubjectFamily, "generic">, [string, string, string]> = {
  //                topic (primary)      action                 surface
  contact: ["contact question", "your contact form", "getting in touch"],
  booking: ["booking question", "your booking page", "appointment booking"],
  mobile_booking: ["booking on mobile", "your booking page", "booking from a phone"],
  mobile_contact: ["contact on mobile", "your contact form", "reaching you"],
  readability: ["reading your site", "your site text", "hard-to-read text"],
  search: ["finding you on google", "your google listing", "your search result"],
  analytics: ["tracking your leads", "your lead tracking", "measuring signups"],
};

// Retired generic web-sales subject phrasings (§16). A package must never keep one on an
// ACTIVE outbound-ready subject; the coherence gate blocks them and the canonical package
// treats them as non-specific.
const RETIRED_SUBJECTS = new Set([
  "website note", "website review", "website inquiry", "site audit",
  "quick website fix", "website problem", "website improvement", "website audit",
]);

/** True when a subject is a retired generic web-sales phrasing that must not ship (§16). */
export function isRetiredSubject(subject: string): boolean {
  return RETIRED_SUBJECTS.has((subject ?? "").trim().toLowerCase());
}

/**
 * Classify an evidence text into a defect family. A mapping is used ONLY when the
 * text actually describes that issue — we never reach for "online booking" unless
 * the evidence mentions booking/appointments/scheduling, etc. Returns "generic"
 * when no mapping accurately fits (the safe, non-fabricating fallback).
 */
export function classifyDefectFamily(input: Pick<SubjectInput, "observation" | "context" | "category">): SubjectFamily {
  const t = `${input.observation} ${input.context ?? ""}`.toLowerCase();

  const isMobile = /\bmobile\b|\bphone\b|\bsmartphone\b|\bviewport\b|\bresponsive\b|\bon (a )?phone\b/.test(t);
  const isBooking = /\bbook(ing)?\b|\bappointment\b|\bschedul(e|ing)\b|\bcalendar\b|\breservation\b/.test(t);
  const isContact = /\bcontact form\b|\bcontact\b|\binquiry\b|\benquir(y|ies)\b|\blead (form|capture)\b|\bform submission\b|\bget in touch\b|\bcontact button\b|\bcontact us\b|\bform\b/.test(t);
  const isReadability = /\breadab|\baccessib|\bcontrast\b|\bfont size\b|\btext (is )?(too )?(small|hard to read)\b|\balt text\b|\bwcag\b|\blegib/.test(t);
  const isSearch = /\bmeta ?data\b|\bmeta description\b|\btitle tag\b|\bsearch (result|listing)\b|\bgoogle (result|listing|search)\b|\bschema\b|\bsnippet\b|\bindex(ed|ing)?\b/.test(t);
  const isAnalytics = /\banalytic|\btracking\b|\btag manager\b|\bpixel\b|\bevent tracking\b|\bmeasure|\bga4\b|\bconversion tracking\b/.test(t);

  // Mobile-qualified families take precedence ONLY when a mobile signal co-occurs
  // with the specific surface — otherwise the broader topic wins.
  if (isMobile && isBooking) return "mobile_booking";
  if (isMobile && isContact && !isBooking) return "mobile_contact";
  if (isBooking) return "booking";
  if (isContact) return "contact";
  if (isReadability) return "readability";
  if (isSearch) return "search";
  if (isAnalytics) return "analytics";
  return "generic";
}

/**
 * Generate the three deterministic subject candidates for a real defect.
 *
 *   candidates[0] = primary = operational topic
 *   candidates[1] = affected customer action
 *   candidates[2] = affected surface
 *
 * The company name is NEVER included in a default first-touch (includeCompany OFF).
 * If a mapped triple somehow failed policy it is not emitted; a compliant generic
 * fallback ("website note") is used instead — we prefer under-claiming to lying.
 */
export function generateSubjectCandidates(input: SubjectInput): SubjectCandidates {
  const family = classifyDefectFamily(input);

  let triple: [string, string, string];
  if (family === "generic") {
    // No accurate mapping. Do NOT assert a specific broken thing — a neutral, business-
    // natural "quick question" (§16), never a retired web-sales phrasing. A generic-family
    // package is rejected upstream by the Problem Reality gate, so this rarely ships.
    triple = ["quick question", "quick question", "quick question"];
  } else {
    triple = FAMILY_TRIPLES[family];
  }

  // Every candidate must pass policy. A generic fallback replaces any that doesn't
  // (defense in depth — the curated triples are authored to pass).
  const safe = triple.map((c) => (isPolicyCompliantSubject(c) ? c : "quick question")) as [string, string, string];

  // De-dupe alternates against the primary while preserving role order, so the
  // operator always sees genuinely distinct choices.
  const primary = safe[0];
  const alternates = safe.slice(1).filter((c, i, a) => c !== primary && a.indexOf(c) === i);
  // Guarantee exactly two alternates for a stable UI (pad from the surface if a
  // collision removed one — rare; the triples are authored distinct).
  while (alternates.length < 2) alternates.push(safe[2] !== primary ? safe[2] : safe[1]);

  return {
    primary,
    alternates: alternates.slice(0, 2),
    family,
    policyVersion: SUBJECT_POLICY_VERSION,
    defectType: family,
  };
}

/** All three candidates as a flat list (primary first) — convenience for the UI. */
export function subjectCandidateList(c: SubjectCandidates): string[] {
  return [c.primary, ...c.alternates];
}

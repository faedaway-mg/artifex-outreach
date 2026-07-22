// ─────────────────────────────────────────────────────────────────────────────
// Memory detection — turn conversation notes into candidate Relationship Memory.
//
// NOT keyword matching. A small, honest extraction layer: structured patterns
// per concept, each preserving the ORIGINAL quote so nothing is ever detached
// from its evidence. Nothing is committed — the operator approves. Deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import type { MemoryCategory, MemoryConfidence } from "./types";

// Natural concepts the operator actually thinks in (Phase 7). Richer categories
// live underneath; the surface stays effortless.
export const NATURAL_CONCEPTS = ["People", "Goals", "Systems", "Constraints", "Preferences", "Decisions", "History", "Questions"] as const;
export type NaturalConcept = (typeof NATURAL_CONCEPTS)[number];

export const CONCEPT_OF_CATEGORY: Record<MemoryCategory, NaturalConcept> = {
  "Decision Makers": "People",
  "Business Goals": "Goals",
  "Current Priorities": "Goals",
  "Known Constraints": "Constraints",
  "Existing Systems": "Systems",
  "Communication Style": "Preferences",
  "Business Philosophy": "Preferences",
  "Preferred Follow-up Style": "Preferences",
  "Important Dates": "History",
  "Open Questions": "Questions",
  "Previous Decisions": "Decisions",
};

export interface DetectedMemory {
  category: MemoryCategory;
  concept: NaturalConcept;
  title: string;
  value: string;
  confidence: MemoryConfidence;
  /** The exact words that produced this — evidence is never lost. */
  quote: string;
}

// Tools we can name with confidence when they appear after "we use / we're on".
const TOOLS = [
  "Square", "Clover", "Toast", "Stripe", "Calendly", "Acuity", "Dentrix", "Eaglesoft", "Open Dental", "Curve",
  "QuickBooks", "Xero", "FreshBooks", "Mailchimp", "Klaviyo", "Constant Contact", "HubSpot", "Salesforce",
  "Shopify", "Wix", "Squarespace", "WordPress", "GoDaddy", "Housecall Pro", "ServiceTitan", "Jobber",
  "Mindbody", "Vagaro", "Booksy", "SimplePractice", "Podium", "Weave", "NexHealth",
];

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n).trim() + "…" : s);

export function detectMemories(text: string): DetectedMemory[] {
  const found: DetectedMemory[] = [];
  const add = (category: MemoryCategory, title: string, value: string, confidence: MemoryConfidence, quote: string) =>
    found.push({ category, concept: CONCEPT_OF_CATEGORY[category], title: clip(title, 48), value: clip(value, 160), confidence, quote: clip(quote, 200) });

  for (const s of sentences(text)) {
    const low = s.toLowerCase();

    // ── Existing Systems — named tool after "we use / we're on / we run" ──────
    for (const tool of TOOLS) {
      const re = new RegExp(`\\b(we(?:'re| are| use| run| have| moved to| switched to)|on)\\s+(?:the\\s+)?${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(s)) { add("Existing Systems", tool, `They use ${tool}.`, "High", s); break; }
    }

    // ── People / Decision Makers — "the owner is X", "X owns/runs it" ─────────
    let m = s.match(/\b(?:the |our )?(owner|founder|office manager|practice owner|general manager|manager|principal)\s+(?:is|'s|,)\s+([A-Z][a-z]+)/);
    if (m) add("Decision Makers", `${cap(m[1])}: ${m[2]}`, `${m[2]} is the ${m[1].toLowerCase()}.`, "High", s);
    m = s.match(/\b([A-Z][a-z]+)\s+(owns|runs|founded|manages)\s+(?:the|this)\b/);
    if (m) add("Decision Makers", m[1], `${m[1]} ${m[2]} the business.`, "High", s);

    // ── Goals — "we're trying to hire / grow / open / add / launch …" ─────────
    // Allow intervening words ("trying to", "hoping to", "planning to") between
    // the subject and the goal verb, but stay within the sentence.
    m = s.match(/\bwe(?:'re| are| want| plan| hope| would like|'d like)?\b[^.?!]{0,24}?\b(hir\w+|grow\w*|expand\w*|open\w*|add\w*|launch\w*|scal\w+|double\w*|increas\w+|bring on)\b(.*)/i);
    if (m) add("Business Goals", cap(m[1].replace(/ing$/, "e")), cap((m[1] + m[2]).trim()) + ".", "Medium", s);

    // ── Constraints — "we never / don't / only … after 2pm" ───────────────────
    m = s.match(/\bwe (never|don't|do not|can't|cannot|no longer|only)\b(.*)/i);
    const timeM = s.match(/\b(after|before|until|past)\s+(\d{1,2})\s?(am|pm)\b/i);
    if (timeM) add("Known Constraints", `${cap(timeM[1])} ${timeM[2]}${timeM[3].toLowerCase()}`, cap(s), "High", s);
    else if (m && !/like|love|prefer|want|dislike|hate|into|fans/i.test(m[2])) add("Known Constraints", cap((m[1] + m[2]).trim()), cap(s), "Medium", s);

    // ── Preferences / Philosophy — "we don't like / prefer / avoid …" ─────────
    m = s.match(/\bwe (don't (?:really )?like|do not like|dislike|hate|avoid|prefer|love|value|are not (?:fans|into)|believe in)\b(.*)/i);
    if (m) {
      const obj = m[2].replace(/\.$/, "").trim();
      const isSub = /subscription|recurring|monthly fee|contracts?/i.test(obj);
      add("Business Philosophy", isSub ? "Avoids recurring costs" : cap(clip(obj, 40)), isSub ? "Prefers to avoid recurring software costs." : cap(s), "Medium", s);
    }
    if (/\b(prefer|rather)\b.*\b(call|phone|talk)\b/i.test(low) || /\bnot? (?:a )?(?:big )?(?:email|text)\b/i.test(low))
      add("Communication Style", "Phone-first", "Prefers phone conversations over email.", "Medium", s);

    // ── Important Dates — "opening/launching … next month / Q2 / 2027" ────────
    m = s.match(/\b(opening|launching|moving|expanding|renovat\w+|by|in)\b.*?\b(next (?:month|quarter|year)|q[1-4]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|20\d{2})\b/i);
    if (m) add("Important Dates", cap(m[2]), cap(s), "Medium", s);

    // ── Current Priority — "our biggest problem/challenge right now is …" ─────
    m = s.match(/\b(?:our biggest|the biggest|our main|right now our|currently our)\s+(problem|challenge|priority|focus|issue|headache|bottleneck)\b(.*)/i);
    if (m) add("Current Priorities", `Biggest ${m[1].toLowerCase()}`, cap(s), "High", s);
  }

  // Dedupe by category + normalized value; keep the highest confidence.
  const rank: Record<MemoryConfidence, number> = { High: 3, Medium: 2, Low: 1 };
  const byKey = new Map<string, DetectedMemory>();
  for (const d of found) {
    const k = `${d.category}|${d.value.toLowerCase()}`;
    const prev = byKey.get(k);
    if (!prev || rank[d.confidence] > rank[prev.confidence]) byKey.set(k, d);
  }
  return [...byKey.values()];
}

// ── Adaptive assistant — what's still missing (gentle, never a script) ───────
const CORE_CONCEPTS: NaturalConcept[] = ["People", "Goals", "Systems", "Constraints", "Preferences"];
const CONCEPT_PROMPT: Record<NaturalConcept, string> = {
  People: "Who actually owns the decision here?",
  Goals: "What are they trying to do this year?",
  Systems: "What tools do they already rely on?",
  Constraints: "What are they unwilling — or unable — to change?",
  Preferences: "How do they prefer to be reached?",
  Decisions: "Have they already decided anything relevant?",
  History: "Any important dates coming up?",
  Questions: "What's still unclear?",
};

/** Concepts with no memory yet → gentle reminders to stay curious about. */
export function missingConcepts(coveredConcepts: NaturalConcept[]): Array<{ concept: NaturalConcept; prompt: string }> {
  const have = new Set(coveredConcepts);
  return CORE_CONCEPTS.filter((c) => !have.has(c)).map((c) => ({ concept: c, prompt: CONCEPT_PROMPT[c] }));
}

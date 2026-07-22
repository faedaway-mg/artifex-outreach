// ─────────────────────────────────────────────────────────────────────────────
// Contradiction detection — surface conflicts, never resolve them.
//
// Businesses contradict themselves across conversations. When two standing memories
// touch the same topic with opposite polarity ("no scheduling problems" vs "the
// front desk spends three hours a day scheduling"), we flag it and ask the operator
// which should stand. We never decide for them, and we never silently drop either.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem } from "../types";
import type { Contradiction } from "./types";
import { isActive } from "./confidence";

const text = (m: RelationshipMemoryItem) => `${m.title} ${m.value} ${m.supportingContext ?? ""}`.toLowerCase();

// Topics we can reason about polarity on, with the words that signal each.
const TOPICS: Array<{ topic: string; words: string[] }> = [
  { topic: "scheduling", words: ["schedul", "booking", "appointment", "front desk", "calendar"] },
  { topic: "phones & calls", words: ["phone", "calls", "answering", "voicemail", "missed call"] },
  { topic: "staffing & capacity", words: ["staff", "hire", "team", "capacity", "overwhelm", "understaffed", "busy"] },
  { topic: "online presence", words: ["website", "online", "google", "reviews", "social"] },
  { topic: "budget & cost", words: ["budget", "cost", "afford", "expensive", "cheap", "price", "spend"] },
  { topic: "technology", words: ["software", "system", "tool", "tech", "automat", "manual"] },
];

// Words that assert a problem exists.
const PROBLEM = ["overwhelm", "hours", "struggle", "behind", "bottleneck", "missed", "lose", "lost", "pain", "difficult", "too much", "can't keep", "slow", "constant", "problem", "issue", "trouble"];
// A problem word inside a negation ("no scheduling problems") means the opposite.
const NEGATED_PROBLEM = /\b(no|not|don'?t|do not|never|without|hardly|rarely)\b[^.]{0,24}\b(problem|issue|trouble|complaint|struggl|behind|bottleneck|overwhelm)/;
const FINE = /\b(it's fine|are fine|is fine|handled|runs smooth|smoothly|under control|works well|no complaints|all good|going well|no trouble)\b/;

function polarity(m: RelationshipMemoryItem): "problem" | "fine" | null {
  const t = text(m);
  if (NEGATED_PROBLEM.test(t) || FINE.test(t)) return "fine";
  if (PROBLEM.some((w) => t.includes(w))) return "problem";
  return null;
}

function topicsOf(m: RelationshipMemoryItem): string[] {
  const t = text(m);
  return TOPICS.filter((x) => x.words.some((w) => t.includes(w))).map((x) => x.topic);
}

function properNames(m: RelationshipMemoryItem): string[] {
  return (m.value.match(/\b[A-Z][a-z]{2,}\b/g) ?? []).filter((w) => !["The", "They", "Our", "Their", "This", "That", "Front", "Owner", "Manager"].includes(w));
}

export function detectContradictions(memories: RelationshipMemoryItem[]): Contradiction[] {
  const active = memories.filter(isActive);
  const out: Contradiction[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;

      // ── Polarity conflict on a shared topic ────────────────────────────────
      const shared = topicsOf(a).find((t) => topicsOf(b).includes(t));
      if (shared) {
        const pa = polarity(a);
        const pb = polarity(b);
        if (pa && pb && pa !== pb) {
          seen.add(key);
          out.push({
            id: `contra_${a.id}_${b.id}`,
            topic: shared,
            between: [a.id, b.id],
            explanation: `On ${shared}, one memory says it's fine while another describes a real problem. They can't both be current.`,
            prompt: "Which reflects the business today? Verify one and supersede the other — don't let both stand.",
          });
          continue;
        }
      }

      // ── Two different named decision-makers for the same role ──────────────
      if (a.category === "Decision Makers" && b.category === "Decision Makers") {
        const na = properNames(a);
        const nb = properNames(b);
        if (na.length && nb.length && !na.some((n) => nb.includes(n))) {
          seen.add(key);
          out.push({
            id: `contra_${a.id}_${b.id}`,
            topic: "who decides",
            between: [a.id, b.id],
            explanation: `Two memories name different people as the decision-maker (${na[0]} vs ${nb[0]}). One may be out of date.`,
            prompt: "Confirm who actually owns the decision today, and supersede the other.",
          });
        }
      }
    }
  }
  return out;
}

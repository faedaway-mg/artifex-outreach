// ─────────────────────────────────────────────────────────────────────────────
// The business narrative — a living account, not a summary.
//
// "Over the last three conversations we've learned that…" — prose that reads like a
// consultant quietly organising everything learned so far. Every section links back
// to the memories beneath it. It grows as memory grows; it never states more than
// the evidence supports, and it names what's still unknown.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem, MemoryCategory } from "../types";
import type { BusinessNarrative, NarrativeSection, NarrativeKey, Inference, Contradiction } from "./types";
import { isActive } from "./confidence";

const DAY = 86_400_000;

function join(items: string[]): string {
  const c = items.filter(Boolean);
  if (c.length === 0) return "";
  if (c.length === 1) return c[0];
  if (c.length === 2) return `${c[0]} and ${c[1]}`;
  return `${c.slice(0, -1).join(", ")}, and ${c[c.length - 1]}`;
}
const lower1 = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const stripDot = (s: string) => s.replace(/\.$/, "");

/** Rough count of distinct conversations, from dated conversational sources. */
function conversationCount(active: RelationshipMemoryItem[]): number {
  const days = new Set<string>();
  for (const m of active) {
    if (m.source === "Discovery Meeting" || m.source === "Email Conversation") {
      const d = new Date(m.createdAt);
      if (!isNaN(+d)) days.add(d.toISOString().slice(0, 10));
    }
  }
  return days.size;
}

function inCat(active: RelationshipMemoryItem[], ...cats: MemoryCategory[]) {
  return active.filter((m) => cats.includes(m.category));
}
const ids = (ms: RelationshipMemoryItem[]) => ms.map((m) => m.id);

export function buildNarrative(
  memories: RelationshipMemoryItem[],
  inferences: Inference[],
  contradictions: Contradiction[],
  now: number,
): BusinessNarrative {
  const active = memories.filter(isActive);
  const sections: NarrativeSection[] = [];
  const push = (key: NarrativeKey, prose: string, memoryIds: string[]) => {
    if (prose) sections.push({ key, prose, memoryIds });
  };

  // ── Opening ─────────────────────────────────────────────────────────────────
  const convos = conversationCount(active);
  const opening =
    active.length === 0
      ? "We haven't captured anything about this business yet. The picture below fills in as you talk with them."
      : convos >= 2
        ? `Over the last ${convos} conversations we've learned enough to start seeing how ${"this business"} actually runs.`
        : "From what we've gathered so far, a picture of how this business runs is beginning to form.";

  // ── Current State (operational inferences + priorities) ──────────────────────
  const opInf = inferences.filter((i) => i.kind === "operational" || i.kind === "relationship");
  const priorities = inCat(active, "Current Priorities");
  const stateBits: string[] = [];
  opInf.forEach((i) => stateBits.push(lower1(stripDot(i.claim))));
  priorities.forEach((p) => stateBits.push(lower1(stripDot(p.value))));
  push(
    "Current State",
    stateBits.length ? `Right now, ${join(stateBits.slice(0, 3))}.` : "",
    [...new Set([...opInf.flatMap((i) => i.memoryIds), ...ids(priorities)])],
  );

  // ── Goals ────────────────────────────────────────────────────────────────────
  const goals = inCat(active, "Business Goals");
  push("Goals", goals.length ? `They're working toward ${join(goals.map((g) => lower1(stripDot(g.value))))}.` : "", ids(goals));

  // ── Constraints ──────────────────────────────────────────────────────────────
  const constraints = inCat(active, "Known Constraints");
  push("Constraints", constraints.length ? `What they won't or can't change: ${join(constraints.map((c) => lower1(stripDot(c.value))))}.` : "", ids(constraints));

  // ── Systems ──────────────────────────────────────────────────────────────────
  const systems = inCat(active, "Existing Systems");
  push("Systems", systems.length ? `They already rely on ${join(systems.map((s) => stripDot(s.value)))}.` : "", ids(systems));

  // ── People ───────────────────────────────────────────────────────────────────
  const people = inCat(active, "Decision Makers", "Communication Style");
  push("People", people.length ? `On the human side: ${join(people.map((p) => lower1(stripDot(p.value))))}.` : "", ids(people));

  // ── Risks (contradictions, values watch-outs, ageing evidence) ───────────────
  const riskInf = inferences.filter((i) => i.kind === "risk");
  const riskBits: string[] = [];
  riskInf.forEach((i) => riskBits.push(lower1(stripDot(i.claim))));
  if (contradictions.length) riskBits.push(`there ${contradictions.length === 1 ? "is a point" : `are ${contradictions.length} points`} where what they've told us doesn't line up yet`);
  const stale = active.filter((m) => now - (Date.parse(m.updatedAt || m.createdAt) || now) > 120 * DAY);
  if (stale.length) riskBits.push("some of what we know hasn't been confirmed in a while");
  push("Risks", riskBits.length ? `Worth holding lightly: ${join(riskBits)}.` : "", [...new Set([...riskInf.flatMap((i) => i.memoryIds), ...contradictions.flatMap((c) => c.between)])]);

  // ── Opportunities ────────────────────────────────────────────────────────────
  const oppInf = inferences.filter((i) => i.kind === "opportunity");
  push("Opportunities", oppInf.length ? `Where we might help: ${join(oppInf.map((i) => lower1(stripDot(i.claim))))}.` : "", oppInf.flatMap((i) => i.memoryIds));

  // ── Unknowns (open questions + empty core categories) ────────────────────────
  const questions = inCat(active, "Open Questions");
  const CORE: MemoryCategory[] = ["Decision Makers", "Business Goals", "Known Constraints", "Existing Systems"];
  const gaps = CORE.filter((c) => !active.some((m) => m.category === c));
  const unkBits: string[] = [];
  questions.forEach((q) => unkBits.push(lower1(stripDot(q.value))));
  if (gaps.length) unkBits.push(`we still don't have a clear read on ${join(gaps.map(gapLabel))}`);
  push("Unknowns", unkBits.length ? `Still open: ${join(unkBits)}.` : "", ids(questions));

  return { opening, sections };
}

function gapLabel(c: MemoryCategory): string {
  switch (c) {
    case "Decision Makers": return "who really decides";
    case "Business Goals": return "what they're trying to do";
    case "Known Constraints": return "what they won't change";
    case "Existing Systems": return "what tools they run";
    default: return c.toLowerCase();
  }
}

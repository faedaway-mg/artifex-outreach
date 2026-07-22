// ─────────────────────────────────────────────────────────────────────────────
// The reasoning engine — connect verified memory into consultant-grade judgment.
//
// Each rule looks for a specific pattern ACROSS memories. It only fires when the
// supporting memories actually exist, and the resulting inference cites every one
// of them. Confidence is measured from that same evidence. We recognise patterns;
// we never predict or invent. If the evidence isn't there, the inference isn't made.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem } from "../types";
import type { Inference, InferenceKind } from "./types";
import { scoreConfidence, isActive } from "./confidence";

const text = (m: RelationshipMemoryItem) => `${m.title} ${m.value} ${m.supportingContext ?? ""}`.toLowerCase();
const hits = (m: RelationshipMemoryItem, ...kw: string[]) => kw.some((k) => text(m).includes(k));

interface Rule {
  id: string;
  kind: InferenceKind;
  /** Select the supporting memories from the active set; return [] to skip. */
  select: (active: RelationshipMemoryItem[]) => RelationshipMemoryItem[];
  claim: string;
  because: string;
}

const RULES: Rule[] = [
  {
    id: "manual-scheduling",
    kind: "operational",
    claim: "Scheduling likely depends heavily on manual coordination today.",
    because: "The people, systems, and constraints on record all point at hands-on booking rather than an automated flow.",
    select: (a) => {
      const people = a.filter((m) => m.category === "Decision Makers" && hits(m, "schedul", "book", "front desk", "phone", "calls"));
      const owner = a.filter((m) => m.category === "Decision Makers" && hits(m, "owner", "manager"));
      const systems = a.filter((m) => m.category === "Existing Systems" && hits(m, "paper", "manual", "no online", "no booking", "square", "phone", "spreadsheet", "pen"));
      const friction = a.filter(
        (m) => (m.category === "Known Constraints" || m.category === "Current Priorities") && hits(m, "schedul", "front desk", "overwhelm", "phone", "calls", "booking", "double book", "no-show"),
      );
      const support = [...new Set([...people, ...owner, ...systems, ...friction])];
      // Need at least two distinct signals from different angles.
      const angles = [people.length || owner.length, systems.length, friction.length].filter(Boolean).length;
      return angles >= 2 && support.length >= 2 ? support : [];
    },
  },
  {
    id: "capacity-bound-growth",
    kind: "relationship",
    claim: "Their growth ambition is bounded by capacity, not demand.",
    because: "They want to grow while already describing the team as stretched — so the constraint is throughput, not interest.",
    select: (a) => {
      const goals = a.filter((m) => m.category === "Business Goals" && hits(m, "hire", "grow", "expand", "open", "add", "scale", "second location", "more"));
      const strain = a.filter(
        (m) => (m.category === "Known Constraints" || m.category === "Current Priorities") && hits(m, "overwhelm", "stretched", "busy", "behind", "bottleneck", "capacity", "no time", "understaffed", "short-staffed"),
      );
      return goals.length && strain.length ? [...goals, ...strain] : [];
    },
  },
  {
    id: "integration-over-replacement",
    kind: "opportunity",
    claim: "They already run several tools — integration will matter more than replacement.",
    because: "Multiple systems are in daily use, so the useful move is connecting what works, not tearing it out.",
    select: (a) => {
      const systems = a.filter((m) => m.category === "Existing Systems");
      return systems.length >= 2 ? systems : [];
    },
  },
  {
    id: "values-resist-recurring",
    kind: "risk",
    claim: "Recurring-fee software will meet resistance; favour tools they own or pay for once.",
    because: "They've said they avoid subscriptions, and they already lean on tools they control — so a monthly fee is a friction point, not a detail.",
    select: (a) => {
      const philosophy = a.filter((m) => m.category === "Business Philosophy" && hits(m, "subscription", "recurring", "monthly", "contract", "own"));
      const systems = a.filter((m) => m.category === "Existing Systems");
      return philosophy.length && systems.length ? [...philosophy, ...systems] : [];
    },
  },
  {
    id: "relationships-carry-work",
    kind: "relationship",
    claim: "Personal relationships likely carry more of the business than any tool does.",
    because: "A named owner stays close to the work and they prefer direct contact — trust is doing the heavy lifting, not systems.",
    select: (a) => {
      const owner = a.filter((m) => m.category === "Decision Makers" && hits(m, "owner", "founder", "handles", "runs", "does"));
      const style = a.filter((m) => m.category === "Communication Style" || (m.category === "Business Philosophy" && hits(m, "personal", "relationship", "touch", "call", "know")));
      return owner.length && style.length ? [...owner, ...style] : [];
    },
  },
];

/**
 * Draw every inference the current memory supports. Deterministic; ordered by
 * confidence then id. `now` (ms) drives the recency component of confidence.
 */
export function reason(memories: RelationshipMemoryItem[], now: number): Inference[] {
  const active = memories.filter(isActive);
  const out: Inference[] = [];
  for (const rule of RULES) {
    const support = rule.select(active);
    if (support.length < 2) continue; // connective inferences need ≥2 memories
    const memoryIds = [...new Set(support.map((m) => m.id))];
    out.push({
      id: rule.id,
      kind: rule.kind,
      claim: rule.claim,
      because: rule.because,
      memoryIds,
      confidence: scoreConfidence(support, now),
    });
  }
  return out.sort((x, y) => y.confidence.score - x.confidence.score || x.id.localeCompare(y.id));
}

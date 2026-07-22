// ─────────────────────────────────────────────────────────────────────────────
// Adaptive follow-up references — memory in the founder's voice.
//
// A follow-up should sound like a continuing relationship, not a database report.
// "You mentioned your front desk is spending several hours a day coordinating
// appointments" — never "our system detected". We only reference memory that's
// been verified (or that the operator is confident in), so we never remind someone
// of something they didn't say. Each line carries the memory id it came from.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem, MemoryCategory } from "../types";
import type { MemoryReference } from "./types";
import { isActive } from "./confidence";

const lower1 = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const stripDot = (s: string) => s.replace(/\.$/, "").trim();

// How each kind of memory naturally re-enters a conversation.
function phrase(m: RelationshipMemoryItem): string {
  const v = lower1(stripDot(m.value));
  switch (m.category as MemoryCategory) {
    case "Business Goals": return `You mentioned you're working toward ${v}.`;
    case "Known Constraints": return `You'd said ${v} — I've kept that front of mind.`;
    case "Current Priorities": return `Last time, ${v} was the thing weighing on you most.`;
    case "Existing Systems": return `Since you're already running ${stripDot(m.value)}, I've been thinking about how anything we do would sit alongside it.`;
    case "Decision Makers": return `I know ${v}, so I want to make sure this is useful for the way you actually make these calls.`;
    case "Business Philosophy": return `You were clear that ${v}, and that's shaped how I'd approach this.`;
    default: return `You mentioned ${v}.`;
  }
}

/**
 * Natural opening lines for a follow-up, grounded in confirmed memory. Ordered by
 * how strongly we hold each (verified first). Returns at most `limit`.
 */
export function memoryReferences(memories: RelationshipMemoryItem[], limit = 3): MemoryReference[] {
  const usable = memories
    .filter(isActive)
    .filter((m) => m.status === "Verified" || m.confidence === "High" || m.source === "Manual Confirmation")
    .sort((a, b) => Number(b.status === "Verified") - Number(a.status === "Verified"));
  return usable.slice(0, limit).map((m) => ({ sentence: phrase(m), memoryId: m.id }));
}

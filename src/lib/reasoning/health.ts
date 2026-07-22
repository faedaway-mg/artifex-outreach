// ─────────────────────────────────────────────────────────────────────────────
// Relationship health — progress explained by evidence, never an arbitrary score.
//
// A consultant knows where a relationship stands: has discovery happened, do we
// know who decides, is trust forming, has a proposal been discussed, is work under
// way, is there room to be referred on. Each milestone is either reached or not,
// and always with a one-line reason drawn from real signals.
// ─────────────────────────────────────────────────────────────────────────────
import type { RelationshipMemoryItem } from "../types";
import type { HealthSignal } from "./types";
import { isActive } from "./confidence";

export interface HealthContext {
  meetingsHeld: number;
  proposalsDiscussed: number;
  activePlans: number;
  acceptedProposals: number;
}

const text = (m: RelationshipMemoryItem) => `${m.title} ${m.value}`.toLowerCase();

export function relationshipHealth(memories: RelationshipMemoryItem[], ctx: HealthContext): HealthSignal[] {
  const active = memories.filter(isActive);
  const categories = new Set(active.map((m) => m.category));
  const verified = active.filter((m) => m.status === "Verified");
  const decisionMaker = active.filter((m) => m.category === "Decision Makers");
  const referral = active.filter((m) => text(m).includes("referral") || text(m).includes("refer us") || text(m).includes("introduce"));

  const signal = (milestone: string, reached: boolean, evidence: string, memoryIds: string[] = []): HealthSignal => ({ milestone, reached, evidence, memoryIds });

  return [
    signal(
      "Discovery underway",
      active.length > 0 || ctx.meetingsHeld > 0,
      active.length > 0 ? `We've captured ${active.length} thing${active.length === 1 ? "" : "s"} about how they operate.` : ctx.meetingsHeld > 0 ? "A conversation has happened; notes still to capture." : "Nothing captured yet.",
      active.slice(0, 6).map((m) => m.id),
    ),
    signal(
      "Decision-maker identified",
      decisionMaker.some((m) => m.status === "Verified") || decisionMaker.length > 0,
      decisionMaker.length === 0 ? "We don't yet know who owns the decision." : decisionMaker.some((m) => m.status === "Verified") ? "We know who decides, and it's confirmed." : "We have a name, but it isn't confirmed yet.",
      decisionMaker.map((m) => m.id),
    ),
    signal(
      "Understanding forming",
      active.length >= 3 && categories.size >= 2,
      active.length >= 3 && categories.size >= 2 ? `We understand them across ${categories.size} areas, not just one.` : "Still a thin picture — worth learning more before advising.",
      active.slice(0, 6).map((m) => m.id),
    ),
    signal(
      "Trust building",
      verified.length > 0 || ctx.meetingsHeld > 0,
      verified.length > 0 ? `${verified.length} thing${verified.length === 1 ? "" : "s"} we believe ${verified.length === 1 ? "has" : "have"} been confirmed together.` : ctx.meetingsHeld > 0 ? "A real conversation has happened." : "No dialogue yet.",
      verified.slice(0, 6).map((m) => m.id),
    ),
    signal("Proposal discussed", ctx.proposalsDiscussed > 0, ctx.proposalsDiscussed > 0 ? "A proposal is on the table." : "No proposal has been shared yet."),
    signal("Implementation started", ctx.activePlans > 0 || ctx.acceptedProposals > 0, ctx.activePlans > 0 || ctx.acceptedProposals > 0 ? "Work is under way." : "Nothing in delivery yet."),
    signal("Referral opportunity", referral.length > 0 || ctx.acceptedProposals > 0, referral.length > 0 ? "They've signalled openness to introducing us." : ctx.acceptedProposals > 0 ? "Delivered work earns the right to ask for an introduction." : "Too early to ask for a referral."),
  ];
}

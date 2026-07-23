// ─────────────────────────────────────────────────────────────────────────────
// Baseline snapshots — freeze the "before" when a recommendation is committed to.
//
// When a recommendation moves to Approved or In Progress, we capture an immutable
// picture of the engagement: the memory it rested on, the strategist's read, its
// roadmap placement, and the current narratives. This becomes the "before" for a
// future outcome review, so improvement is always measured against what was actually
// true at the time — never overwritten, never reconstructed after the fact.
// ─────────────────────────────────────────────────────────────────────────────
import type { EngagementContext, EngagementSnapshotPayload } from "./types";
import { buildHealthNarrative } from "../outcomes";

export function composeSnapshot(ctx: EngagementContext, recommendationId: string, trigger: string): EngagementSnapshotPayload {
  const active = ctx.memory.filter((m) => m.status !== "Superseded" && m.status !== "Resolved");
  const placement = [...ctx.plan.items, ...ctx.plan.completed].find((i) => i.recommendationId === recommendationId);
  const latestProposal = [...ctx.proposals].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const reachedHealth = ctx.reasoning.health.filter((h) => h.reached).length;

  return {
    capturedFor: recommendationId,
    trigger,
    memory: active.map((m) => ({ id: m.id, category: m.category, title: m.title, value: m.value, status: m.status })),
    strategist: {
      narrativeOpening: ctx.reasoning.narrative.opening,
      inferences: ctx.reasoning.inferences.map((i) => ({ claim: i.claim, confidence: i.confidence.label })),
    },
    roadmapPlacement: placement ? { phase: placement.phase, why: placement.why } : null,
    businessNarrative: ctx.reasoning.narrative.sections.find((s) => s.key === "Current State")?.prose ?? ctx.reasoning.narrative.opening,
    healthNarrative: buildHealthNarrative(ctx.reviews, ctx.now).opening,
    proposalState: latestProposal ? `Proposal ${latestProposal.number ?? latestProposal.id} · ${latestProposal.status}` : "No proposal yet.",
    relationshipState: `${reachedHealth}/${ctx.reasoning.health.length} relationship milestones reached.`,
  };
}

/** A short, human "before" line derived from a stored snapshot payload. */
export function beforeStateFromSnapshot(payload: EngagementSnapshotPayload): string {
  return payload.businessNarrative || payload.strategist.narrativeOpening || "";
}

export function parseSnapshot(payload: string): EngagementSnapshotPayload | null {
  try {
    return JSON.parse(payload) as EngagementSnapshotPayload;
  } catch {
    return null;
  }
}

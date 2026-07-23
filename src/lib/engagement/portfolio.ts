// ─────────────────────────────────────────────────────────────────────────────
// Portfolio view — the founder's executive read across every business.
//
// One row per engagement: where it sits in its journey, relationship health,
// implementation progress, outcome reviews waiting, the top opportunity, whether
// there's a recent win, and whether it's at risk (a contradiction, a blocker, or gone
// quiet with work still open). Composed from the same deterministic engines — an
// operating system, not a CRM.
// ─────────────────────────────────────────────────────────────────────────────
import type { EngagementContext, PortfolioRow } from "./types";
import { momentumOf } from "./command-center";
import { pendingWork } from "./follow-up";

const DONE = new Set(["Completed", "Measured"]);
const DAY = 86_400_000;

export function buildPortfolioRow(ctx: EngagementContext): PortfolioRow {
  const current = ctx.plan.transformation.find((s) => s.current);
  const reviewedRecs = new Set(ctx.reviews.map((r) => r.recommendationId));
  const awaiting =
    ctx.reviews.filter((r) => r.status === "Awaiting Review").length +
    ctx.progress.filter((p) => DONE.has(p.status) && !reviewedRecs.has(p.recommendationId)).length;

  const recentWin = ctx.reviews.some((r) => r.status === "Supported" && ctx.now - (Date.parse(r.reviewedAt || r.updatedAt) || 0) <= 45 * DAY);
  const momentum = momentumOf(ctx);
  const blockers = ctx.plan.items.filter((i) => i.phase === "Blocked").length;
  const activeWork = ctx.plan.items.length > 0;
  const atRisk = ctx.reasoning.contradictions.length > 0 || blockers > 0 || (momentum.label === "Quiet" && activeWork);

  const pending = pendingWork(ctx);

  return {
    leadId: ctx.lead.id,
    businessName: ctx.lead.businessName,
    stage: current?.key ?? "—",
    healthReached: ctx.reasoning.health.filter((h) => h.reached).length,
    healthTotal: ctx.reasoning.health.length,
    implementedCount: ctx.plan.completed.length,
    recommendationCount: ctx.plan.items.length + ctx.plan.completed.length,
    awaitingReviews: awaiting,
    topOpportunity: ctx.plan.sequence[0]?.title ?? ctx.plan.items[0]?.title ?? null,
    momentum: momentum.label,
    needsFollowUp: pending.filter((p) => p.severity === "high").length,
    recentWin,
    atRisk,
  };
}

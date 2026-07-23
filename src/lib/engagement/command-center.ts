// ─────────────────────────────────────────────────────────────────────────────
// The Engagement Command Center — one surface that answers "what needs me now?".
//
// Pure composition of the intelligence foundation: engagement stage, relationship
// health, current priorities and work in progress, blockers, awaiting reviews, the
// latest learning, recent communications, the next scheduled conversation, pending
// follow-ups, and a slice of the unified timeline. The operator should never have to
// go hunting across tabs to know where things stand.
// ─────────────────────────────────────────────────────────────────────────────
import type { EngagementContext, CommandCenter } from "./types";
import { pendingWork } from "./follow-up";
import { engagementTimeline } from "./timeline";

const DONE = new Set(["Completed", "Measured"]);

export function momentumOf(ctx: EngagementContext): { label: string; tone: string } {
  const times = [
    ...ctx.memory.map((m) => Date.parse(m.updatedAt || m.createdAt) || 0),
    ...ctx.progress.map((p) => Date.parse(p.updatedAt) || 0),
    ...ctx.reviews.map((r) => Date.parse(r.updatedAt) || 0),
    ...ctx.outreach.map((o) => (o.sentAt ? Date.parse(o.sentAt) : 0)),
  ];
  const last = Math.max(0, ...times);
  if (!last) return { label: "Quiet", tone: "text-chalk-400" };
  const days = Math.floor((ctx.now - last) / 86_400_000);
  if (days <= 14) return { label: "Active", tone: "text-emerald-300" };
  if (days <= 45) return { label: "Steady", tone: "text-azure-300" };
  return { label: "Quiet", tone: "text-chalk-400" };
}

export function buildCommandCenter(ctx: EngagementContext): CommandCenter {
  const timeline = engagementTimeline(ctx);
  const reviewedRecs = new Set(ctx.reviews.map((r) => r.recommendationId));
  const awaitingReviewCount =
    ctx.reviews.filter((r) => r.status === "Awaiting Review").length +
    ctx.progress.filter((p) => DONE.has(p.status) && !reviewedRecs.has(p.recommendationId)).length;

  const upcoming = ctx.meetings
    .filter((m) => m.scheduledAt && Date.parse(m.scheduledAt) >= ctx.now)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0] ?? null;

  const firstSeq = ctx.plan.sequence[0];

  return {
    stage: ctx.plan.transformation.find((s) => s.current) ?? null,
    healthReached: ctx.reasoning.health.filter((h) => h.reached).length,
    healthTotal: ctx.reasoning.health.length,
    momentum: momentumOf(ctx),
    priorities: ctx.plan.items.filter((i) => i.phase === "Immediate"),
    currentRecommendation: firstSeq ? { title: firstSeq.title, reason: firstSeq.reason } : null,
    currentImplementation: ctx.plan.items.filter((i) => i.status === "In Progress"),
    blockers: ctx.plan.items.filter((i) => i.phase === "Blocked"),
    awaitingReviewCount,
    latestLearning: [...ctx.memory]
      .filter((m) => m.status !== "Superseded" && m.status !== "Resolved")
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
      .slice(0, 3),
    recentComms: timeline.filter((e) => e.source === "email" || e.source === "reply" || e.source === "meeting").slice(0, 3),
    upcomingFollowUp: upcoming,
    pending: pendingWork(ctx),
    timeline: timeline.slice(0, 12),
  };
}

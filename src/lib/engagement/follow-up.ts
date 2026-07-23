// ─────────────────────────────────────────────────────────────────────────────
// Follow-up workflow — surface pending work, never nag.
//
// We don't create reminders. We read the current state of the engagement and surface
// what genuinely needs attention: an outcome to review, work in progress to measure,
// a blocked item, a contradiction to reconcile, a discovery gap, a proposal that may
// be out of date. Each item says why, what evidence supports it, and what to do next.
// ─────────────────────────────────────────────────────────────────────────────
import type { EngagementContext, FollowUpItem } from "./types";
import { hasObservation } from "../outcomes";

const DONE = new Set(["Completed", "Measured"]);
const SEV = { high: 0, medium: 1, low: 2 } as const;

export function pendingWork(ctx: EngagementContext): FollowUpItem[] {
  const base = `/leads/${ctx.lead.id}`;
  const out: FollowUpItem[] = [];
  const reviewByRec = new Map(ctx.reviews.map((r) => [r.recommendationId, r]));

  // ── Completed work that hasn't been measured ───────────────────────────────
  for (const p of ctx.progress) {
    if (!DONE.has(p.status)) continue;
    const review = reviewByRec.get(p.recommendationId);
    if (!review) {
      out.push({ id: `fu_review_${p.recommendationId}`, kind: "outcome-review", title: `Measure: ${p.title}`, why: "This work is done but we haven't checked whether it actually helped.", evidence: `Implementation journal · marked ${p.status}.`, nextLabel: "Start outcome review", nextHref: `${base}/outcomes`, severity: "high" });
    } else if (review.status === "Awaiting Review" || !hasObservation(review)) {
      out.push({ id: `fu_review_${p.recommendationId}`, kind: "outcome-review", title: `Finish reviewing: ${p.title}`, why: "The outcome review is open but has no observation and evidence yet.", evidence: "Outcome review · Awaiting Review.", nextLabel: "Record the outcome", nextHref: `${base}/outcomes`, severity: "medium" });
    }
  }

  // ── Work in progress to keep moving ────────────────────────────────────────
  for (const it of ctx.plan.items.filter((i) => i.status === "In Progress")) {
    out.push({ id: `fu_prog_${it.recommendationId}`, kind: "measure", title: `In progress: ${it.title}`, why: "Underway — worth confirming it lands, then measuring it.", evidence: "Implementation journal · In Progress.", nextLabel: "Open the roadmap", nextHref: `${base}/roadmap`, severity: "low" });
  }

  // ── Blocked items ──────────────────────────────────────────────────────────
  for (const it of ctx.plan.items.filter((i) => i.phase === "Blocked")) {
    out.push({ id: `fu_block_${it.recommendationId}`, kind: "blocked", title: `Blocked: ${it.title}`, why: it.explain.whyNotEarlier, evidence: `Depends on: ${it.explain.whatBlocks}`, nextLabel: "See the roadmap", nextHref: `${base}/roadmap`, severity: "medium" });
  }

  // ── Contradictions to reconcile ────────────────────────────────────────────
  for (const c of ctx.reasoning.contradictions) {
    out.push({ id: `fu_contra_${c.id}`, kind: "contradiction", title: `Reconcile: ${c.topic}`, why: c.explanation, evidence: "Two standing memories conflict.", nextLabel: "Resolve on the Strategist", nextHref: `${base}/reasoning`, severity: "high" });
  }

  // ── Discovery gaps — core things we still don't know ───────────────────────
  const gapSection = ctx.reasoning.narrative.sections.find((s) => s.key === "Unknowns");
  if (gapSection && ctx.memory.filter((m) => m.status !== "Superseded" && m.status !== "Resolved").length > 0 && ctx.plan.items.length === 0) {
    out.push({ id: "fu_discovery", kind: "discovery-gap", title: "Keep learning before advising", why: gapSection.prose, evidence: "Business narrative · Unknowns.", nextLabel: "Open discovery", nextHref: `${base}/discovery`, severity: "low" });
  }

  // ── Proposal may be out of date ────────────────────────────────────────────
  const supported = ctx.reviews.filter((r) => r.status === "Supported").length;
  if (ctx.proposals.length > 0 && (ctx.plan.completed.length > 0 || supported > 0)) {
    out.push({ id: "fu_proposal", kind: "proposal-revision", title: "Refresh the proposal", why: "Work has been completed since the last proposal — the plan has moved on.", evidence: `${ctx.plan.completed.length} completed · ${supported} validated.`, nextLabel: "Review the engagement", nextHref: `${base}/command`, severity: "low" });
  }

  return out.sort((a, b) => SEV[a.severity] - SEV[b.severity]);
}

// The Outcomes surface — the learning end of the consulting lifecycle. Did the work
// we recommended actually help? Every completed recommendation is measured against
// what we expected, grounded only in the operator's observations and evidence.
// Cross-engagement patterns appear only after repeated evidence. Nothing self-succeeds.
import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";
import {
  getLead, memoryForLead, meetingsForLead, proposalsForLead, plansForLead,
  roadmapProgressForLead, outcomeReviewsForLead, allOutcomeReviews, allRoadmapProgress,
} from "@/lib/repo";
import { LeadHeader } from "@/components/lead/LeadHeader";
import { OutcomesWorkspace, type ReviewSlot } from "@/components/lead/OutcomesWorkspace";
import { buildReasoning } from "@/lib/reasoning";
import { buildExecutionPlan } from "@/lib/roadmap";
import {
  buildOutcomesDashboard, buildEvolution, buildHealthNarrative,
  recommendationEffectiveness, buildKnowledgeGraph, proposalEvidenceLines,
} from "@/lib/outcomes";

export const dynamic = "force-dynamic";

export default async function OutcomesPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const [memory, meetings, proposals, plans, progress, reviews, allReviews, everyProgress] = await Promise.all([
    memoryForLead(lead.id),
    meetingsForLead(lead.id),
    proposalsForLead(lead.id),
    plansForLead(lead.id),
    roadmapProgressForLead(lead.id),
    outcomeReviewsForLead(lead.id),
    allOutcomeReviews(),
    allRoadmapProgress(),
  ]);

  const now = Date.now();
  const reasoning = buildReasoning(memory, {
    meetingsHeld: meetings.length,
    proposalsDiscussed: proposals.length,
    activePlans: plans.filter((p) => p.status === "active").length,
    acceptedProposals: proposals.filter((p) => p.status === "accepted").length,
  }, now);
  const active = memory.filter((m) => m.status !== "Superseded" && m.status !== "Resolved");
  const plan = buildExecutionPlan({
    recommendations: reasoning.recommendations,
    progress,
    signals: {
      memories: active.length, categories: new Set(active.map((m) => m.category)).size,
      inferences: reasoning.inferences.length, meetingsHeld: meetings.length,
      proposalsDiscussed: proposals.length, acceptedProposals: proposals.filter((p) => p.status === "accepted").length,
    },
  });

  // One review slot per completed recommendation (∪ any existing review).
  const reviewByRec = new Map(reviews.map((r) => [r.recommendationId, r]));
  const slotMap = new Map<string, ReviewSlot>();
  for (const it of plan.completed) {
    slotMap.set(it.recommendationId, {
      recommendationId: it.recommendationId,
      title: it.title,
      expectedOutcome: it.successMetric.looksLike,
      evidenceMemoryIds: it.evidenceMemoryIds,
      review: reviewByRec.get(it.recommendationId) ?? null,
    });
  }
  for (const r of reviews) {
    if (!slotMap.has(r.recommendationId)) {
      slotMap.set(r.recommendationId, { recommendationId: r.recommendationId, title: r.title, expectedOutcome: r.expectedOutcome, evidenceMemoryIds: [], review: r });
    }
  }
  const slots = [...slotMap.values()];

  const dashboard = buildOutcomesDashboard(reviews, progress);
  const evolution = buildEvolution(reviews, progress);
  const narrative = buildHealthNarrative(reviews, now);
  const effectiveness = recommendationEffectiveness(allReviews, everyProgress);
  const knowledgeGraph = buildKnowledgeGraph(allReviews);
  const proposalLines = proposalEvidenceLines(knowledgeGraph);

  return (
    <div className="space-y-6">
      <LeadHeader lead={lead} />
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <Trophy size={16} className="text-azure-300" />
        <h1 className="text-sm font-semibold text-chalk-100">Outcomes</h1>
        <span className="text-[12px] text-chalk-500">· did it work? — measured against what we expected, grounded in evidence</span>
      </div>
      <OutcomesWorkspace
        slots={slots}
        dashboard={dashboard}
        evolution={evolution}
        narrative={narrative}
        effectiveness={effectiveness}
        knowledgeGraph={knowledgeGraph}
        proposalLines={proposalLines}
        items={memory}
        leadId={lead.id}
      />
    </div>
  );
}

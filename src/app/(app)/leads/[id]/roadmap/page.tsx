// The Roadmap — execution intelligence for a single business. Turns evidence-backed
// recommendations and the operator-approved implementation journal into a phased,
// sequenced, fully-explained plan: what to do now, what waits, what's blocked, and
// where the business sits in its transformation. Nothing advances without the operator.
import { notFound } from "next/navigation";
import { Route } from "lucide-react";
import { getLead, memoryForLead, meetingsForLead, proposalsForLead, plansForLead, roadmapProgressForLead } from "@/lib/repo";
import { LeadHeader } from "@/components/lead/LeadHeader";
import { RoadmapWorkspace } from "@/components/lead/RoadmapWorkspace";
import { buildReasoning } from "@/lib/reasoning";
import { buildExecutionPlan } from "@/lib/roadmap";

export const dynamic = "force-dynamic";

export default async function RoadmapPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const [memory, meetings, proposals, plans, progress] = await Promise.all([
    memoryForLead(lead.id),
    meetingsForLead(lead.id),
    proposalsForLead(lead.id),
    plansForLead(lead.id),
    roadmapProgressForLead(lead.id),
  ]);

  const now = Date.now();
  const reasoning = buildReasoning(
    memory,
    {
      meetingsHeld: meetings.length,
      proposalsDiscussed: proposals.length,
      activePlans: plans.filter((p) => p.status === "active").length,
      acceptedProposals: proposals.filter((p) => p.status === "accepted").length,
    },
    now,
  );

  const active = memory.filter((m) => m.status !== "Superseded" && m.status !== "Resolved");
  const plan = buildExecutionPlan({
    recommendations: reasoning.recommendations,
    progress,
    signals: {
      memories: active.length,
      categories: new Set(active.map((m) => m.category)).size,
      inferences: reasoning.inferences.length,
      meetingsHeld: meetings.length,
      proposalsDiscussed: proposals.length,
      acceptedProposals: proposals.filter((p) => p.status === "accepted").length,
    },
  });

  // Momentum — recency of the last thing we learned or moved.
  const lastTouch = Math.max(
    0,
    ...active.map((m) => Date.parse(m.updatedAt || m.createdAt) || 0),
    ...progress.map((p) => Date.parse(p.updatedAt) || 0),
  );
  const days = lastTouch ? Math.floor((now - lastTouch) / 86_400_000) : 999;
  const momentum = days <= 14 ? { label: "Active", tone: "text-emerald-300" } : days <= 45 ? { label: "Steady", tone: "text-azure-300" } : { label: "Quiet", tone: "text-chalk-400" };

  const recentInsights = [...active]
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <LeadHeader lead={lead} />
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <Route size={16} className="text-azure-300" />
        <h1 className="text-sm font-semibold text-chalk-100">Roadmap</h1>
        <span className="text-[12px] text-chalk-500">· what should happen next — sequenced, explained, and yours to approve</span>
      </div>
      <RoadmapWorkspace plan={plan} reasoning={reasoning} items={memory} leadId={lead.id} momentum={momentum} recentInsights={recentInsights} />
    </div>
  );
}

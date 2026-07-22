// The Strategist — a consultant's read of the business, drawn entirely from
// Relationship Memory. Reasoning, a living narrative, contradictions to reconcile,
// opportunity chains, relationship health, and recommendations that explain
// themselves. Every conclusion links back to the memories beneath it; nothing here
// invents certainty or acts without the operator.
import { notFound } from "next/navigation";
import { Brain } from "lucide-react";
import { getLead, memoryForLead, meetingsForLead, proposalsForLead, plansForLead } from "@/lib/repo";
import { LeadHeader } from "@/components/lead/LeadHeader";
import { StrategistView } from "@/components/lead/StrategistView";
import { buildReasoning } from "@/lib/reasoning";

export const dynamic = "force-dynamic";

export default async function ReasoningPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const [memory, meetings, proposals, plans] = await Promise.all([
    memoryForLead(lead.id),
    meetingsForLead(lead.id),
    proposalsForLead(lead.id),
    plansForLead(lead.id),
  ]);

  const reasoning = buildReasoning(
    memory,
    {
      meetingsHeld: meetings.length,
      proposalsDiscussed: proposals.length,
      activePlans: plans.filter((p) => p.status === "active").length,
      acceptedProposals: proposals.filter((p) => p.status === "accepted").length,
    },
    Date.now(),
  );

  return (
    <div className="space-y-6">
      <LeadHeader lead={lead} />
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <Brain size={16} className="text-azure-300" />
        <h1 className="text-sm font-semibold text-chalk-100">Strategist</h1>
        <span className="text-[12px] text-chalk-500">· what we've learned, connected — with every conclusion traceable to its evidence</span>
      </div>
      <StrategistView reasoning={reasoning} items={memory} leadId={lead.id} />
    </div>
  );
}

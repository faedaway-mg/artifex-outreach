// The Engagement Command Center — the primary operating surface for one business.
// It composes the whole intelligence foundation into a single "what needs me now?"
// view and quietly leads to the next step. Deterministic, explainable, read-only here
// (every action lives on the surface it belongs to).
import { notFound } from "next/navigation";
import { Command as CommandIcon } from "lucide-react";
import {
  getLead, memoryForLead, meetingsForLead, proposalsForLead, plansForLead,
  roadmapProgressForLead, outcomeReviewsForLead, outreachForLead, inboundForLead, snapshotsForLead,
} from "@/lib/repo";
import { LeadHeader } from "@/components/lead/LeadHeader";
import { CommandCenter } from "@/components/lead/CommandCenter";
import { assembleEngagementContext, buildCommandCenter } from "@/lib/engagement";

export const dynamic = "force-dynamic";

export default async function CommandPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const [memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots] = await Promise.all([
    memoryForLead(lead.id), meetingsForLead(lead.id), proposalsForLead(lead.id), plansForLead(lead.id),
    roadmapProgressForLead(lead.id), outcomeReviewsForLead(lead.id), outreachForLead(lead.id), inboundForLead(lead.id), snapshotsForLead(lead.id),
  ]);

  const ctx = assembleEngagementContext({ lead, memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots, now: Date.now() });
  const cc = buildCommandCenter(ctx);

  return (
    <div className="space-y-6">
      <LeadHeader lead={lead} />
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <CommandIcon size={16} className="text-azure-300" />
        <h1 className="text-sm font-semibold text-chalk-100">Command center</h1>
        <span className="text-[12px] text-chalk-500">· the whole engagement, in one place</span>
      </div>
      <CommandCenter cc={cc} leadId={lead.id} />
    </div>
  );
}

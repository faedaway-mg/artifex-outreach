// The Business Technology Review — a living consulting document assembled from the
// whole intelligence foundation, with a living proposal beneath it. Every
// recommendation carries traceable evidence; completed work drops out of the proposal.
// Read-only and print-to-PDF here; the underlying data is owned by each subsystem.
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import {
  getLead, memoryForLead, meetingsForLead, proposalsForLead, plansForLead,
  roadmapProgressForLead, outcomeReviewsForLead, outreachForLead, inboundForLead, snapshotsForLead, allOutcomeReviews,
} from "@/lib/repo";
import { LeadHeader } from "@/components/lead/LeadHeader";
import { ReviewDocument } from "@/components/lead/ReviewDocument";
import { PrintButton } from "@/components/lead/PrintButton";
import { assembleEngagementContext, buildConsultingDossier, buildLivingProposal } from "@/lib/engagement";
import { buildKnowledgeGraph } from "@/lib/outcomes";
import { estimateRelationshipValue } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: { id: string } }) {
  const lead = await getLead(params.id);
  if (!lead) notFound();

  const [memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots, allReviews] = await Promise.all([
    memoryForLead(lead.id), meetingsForLead(lead.id), proposalsForLead(lead.id), plansForLead(lead.id),
    roadmapProgressForLead(lead.id), outcomeReviewsForLead(lead.id), outreachForLead(lead.id), inboundForLead(lead.id), snapshotsForLead(lead.id), allOutcomeReviews(),
  ]);

  const ctx = assembleEngagementContext({ lead, memory, meetings, proposals, plans, progress, reviews, outreach, inbound, snapshots, now: Date.now() });
  const dossier = buildConsultingDossier(ctx, buildKnowledgeGraph(allReviews));
  const rv = estimateRelationshipValue(lead);
  const proposal = buildLivingProposal(ctx, dossier, { entry: rv.entry, twelveMonth: rv.confidenceAdjustedTwelveMonth });

  return (
    <div className="space-y-6">
      <LeadHeader lead={lead} />
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <FileText size={16} className="text-azure-300" />
        <h1 className="text-sm font-semibold text-chalk-100">Review &amp; proposal</h1>
        <span className="text-[12px] text-chalk-500">· a living consulting document — every recommendation traced to evidence</span>
        <span className="ml-auto"><PrintButton /></span>
      </div>
      <ReviewDocument dossier={dossier} proposal={proposal} />
    </div>
  );
}

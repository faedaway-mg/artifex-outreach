// Live Meeting Workspace — the surface Jordan opens the moment a discovery
// conversation begins. A calm header (business + the meeting objective + a running
// clock), a distraction-free notes area, and a quiet assistant that turns what he
// hears into candidate Relationship Memory. Knowledge is still earned: nothing is
// saved without an explicit approval. The heavy thinking (the consulting read, the
// mission brief) lives on the Discovery tab; this page is for being present.
import { notFound } from "next/navigation";
import Link from "next/link";
import { Radio, Compass } from "lucide-react";
import { getLead, getBusinessIntelligence, meetingsForLead, memoryForLead } from "@/lib/repo";
import { LeadHeader } from "@/components/lead/LeadHeader";
import { LiveMeetingWorkspace } from "@/components/lead/LiveMeetingWorkspace";
import { buildConsultingRead } from "@/lib/outreach/consulting-read";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [lead, bi, meetings, memory] = await Promise.all([
    getLead(id),
    getBusinessIntelligence(id),
    meetingsForLead(id),
    memoryForLead(id),
  ]);
  if (!lead) notFound();

  // Objective comes from the consulting read where we have intelligence; otherwise
  // a calm, honest default that keeps the operator in questions.
  const objective = bi
    ? buildConsultingRead(lead, bi.profile.businessProfile).meetingObjective
    : `Leave knowing how ${lead.businessName} really works today — in their words.`;

  const meeting = meetings[0];

  return (
    <div className="space-y-6">
      <LeadHeader lead={lead} />

      <div className="card flex flex-wrap items-center gap-2 p-4">
        <Radio size={16} className="text-teal-300" />
        <h1 className="text-sm font-semibold text-chalk-100">Live meeting workspace</h1>
        <span className="text-[12px] text-chalk-500">· take notes, approve what you learn</span>
        <Link href={`/leads/${id}/discovery`} className="ml-auto inline-flex items-center gap-1 text-[12px] text-azure-300 hover:text-chalk-100">
          <Compass size={13} /> Preparation brief
        </Link>
      </div>

      <LiveMeetingWorkspace
        leadId={lead.id}
        businessName={lead.businessName}
        objective={objective}
        initialNotes={meeting?.notes ?? ""}
        existingMemory={memory}
      />
    </div>
  );
}

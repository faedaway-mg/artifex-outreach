"use client";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ActionButton";
import { setMeetingOutcomeAction } from "@/lib/actions";
import { MEETING_OUTCOME, type MeetingOutcome as Outcome } from "@/lib/types";

const LABELS: Record<Outcome, string> = {
  pending: "Pending",
  completed: "Meeting completed",
  follow_up_required: "Follow-up required",
  proposal_required: "Proposal required",
  not_a_fit: "Not a fit",
  nurture: "Move to nurture",
};

export function MeetingOutcome({ meetingId, leadId, current }: { meetingId: string; leadId: string; current: Outcome }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2">
      {MEETING_OUTCOME.filter((o) => o !== "pending").map((o) => (
        <ActionButton
          key={o}
          variant={current === o ? "primary" : "secondary"}
          className="w-full justify-start text-xs"
          onRun={() => setMeetingOutcomeAction(meetingId, leadId, o).then(() => router.refresh())}
        >
          {LABELS[o]}
        </ActionButton>
      ))}
    </div>
  );
}

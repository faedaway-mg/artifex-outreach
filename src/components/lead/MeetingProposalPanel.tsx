"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, FileSignature, Trophy, XCircle, ExternalLink } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { bookMeetingAction, createProposalAction, markWonAction, markLostAction } from "@/lib/actions";
import { formatCurrency, shortDate, timeOfDay } from "@/lib/utils";
import type { Lead, Meeting, Proposal } from "@/lib/types";

export function MeetingProposalPanel({ lead, meetings, proposals }: { lead: Lead; meetings: Meeting[]; proposals: Proposal[] }) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <div className="card p-5">
      <h2 className="mb-4 text-sm font-semibold text-chalk-100">Meetings & proposal</h2>

      {/* Meetings */}
      <div className="mb-5">
        <p className="label mb-2">Meetings</p>
        {meetings.length > 0 && (
          <div className="mb-3 space-y-2">
            {meetings.map((m) => (
              <Link key={m.id} href={`/meetings/${m.id}`} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-2.5 hover:border-white/20">
                <span className="text-sm text-chalk-200">{shortDate(m.scheduledAt)} · {timeOfDay(m.scheduledAt)}</span>
                <span className="text-xs capitalize text-chalk-500">{m.outcome.replace("_", " ")} <ExternalLink size={11} className="inline" /></span>
              </Link>
            ))}
          </div>
        )}
        <form action={bookMeetingAction.bind(null, lead.id)} onSubmit={() => setTimeout(refresh, 400)} className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="field-label">Date & time</span><input name="scheduledAt" type="datetime-local" className="input !w-auto" /></label>
          <label className="block flex-1"><span className="field-label">Meeting link (optional)</span><input name="meetingUrl" placeholder="https://meet.google.com/…" className="input" /></label>
          <button type="submit" className="btn-secondary"><CalendarPlus size={15} /> Book meeting</button>
        </form>
      </div>

      {/* Proposal */}
      <div className="border-t border-white/[0.06] pt-4">
        <p className="label mb-2">Proposal</p>
        {proposals.length > 0 && (
          <div className="mb-3 space-y-2">
            {proposals.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-2.5 text-sm">
                <span className="capitalize text-chalk-300">{p.status}</span>
                <span className="text-chalk-200">{formatCurrency(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <form action={createProposalAction.bind(null, lead.id)} onSubmit={() => setTimeout(refresh, 400)} className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="field-label">Amount</span><input name="amount" type="number" placeholder="11000" className="input !w-32" /></label>
          <label className="block flex-1"><span className="field-label">Proposal URL (optional)</span><input name="proposalUrl" className="input" /></label>
          <button type="submit" className="btn-secondary"><FileSignature size={15} /> Record proposal</button>
        </form>
        <div className="mt-3 flex gap-2">
          <ActionButton variant="primary" onRun={() => markWonAction(lead.id).then(refresh)}><Trophy size={15} /> Mark won</ActionButton>
          <ActionButton variant="danger" onRun={() => markLostAction(lead.id).then(refresh)}><XCircle size={15} /> Mark lost</ActionButton>
        </div>
      </div>
    </div>
  );
}

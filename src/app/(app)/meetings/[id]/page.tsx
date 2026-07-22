import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getMeeting,
  getLead,
  contactsForLead,
  findingsForLead,
  deliverablesForLead,
  videosForLead,
  outreachForLead,
} from "@/lib/repo";
import { updateMeetingNotesAction } from "@/lib/actions";
import { MeetingOutcome } from "@/components/lead/MeetingOutcome";
import { formatRange, shortDate, timeOfDay, joinMeta, formatLocation, deslug } from "@/lib/utils";
import { ArrowLeft, HelpCircle, ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params }: { params: { id: string } }) {
  const meeting = await getMeeting(params.id);
  if (!meeting) notFound();
  const lead = await getLead(meeting.leadId);
  if (!lead) notFound();

  const [contactsList, allFindings, deliverablesList, videosList, outreachList] = await Promise.all([
    contactsForLead(lead.id),
    findingsForLead(lead.id),
    deliverablesForLead(lead.id),
    videosForLead(lead.id),
    outreachForLead(lead.id),
  ]);
  const contact = contactsList[0];
  const findings = allFindings.filter((f) => f.approved);
  const deliverable = deliverablesList.at(-1);
  const video = videosList.find((v) => v.videoUrl);
  const priorOutreach = outreachList.filter((o) => o.status === "sent");

  return (
    <div className="space-y-6">
      <Link href="/meetings" className="inline-flex items-center gap-1.5 text-sm text-chalk-400 hover:text-chalk-100">
        <ArrowLeft size={15} /> All meetings
      </Link>

      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-chalk-50">{lead.businessName}</h1>
            <p className="mt-1 text-sm text-chalk-400">{joinMeta(deslug(lead.industry), formatLocation(lead.city, lead.state))}</p>
            <p className="mt-2 text-sm text-amber-300">{shortDate(meeting.scheduledAt)} · {timeOfDay(meeting.scheduledAt)}</p>
          </div>
          <div className="text-right text-sm">
            {contact && <p className="text-chalk-200">{contact.name}</p>}
            {contact && <p className="text-xs text-chalk-500">{contact.title}</p>}
            {meeting.meetingUrl && <a href={meeting.meetingUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-azure-300">Join link</a>}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Discovery questions */}
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-chalk-100"><HelpCircle size={15} /> Suggested discovery questions</h2>
            <ol className="space-y-2">
              {meeting.discoveryQuestions.map((q, i) => (
                <li key={i} className="flex gap-3 text-sm text-chalk-300">
                  <span className="font-mono text-xs text-chalk-600">{i + 1}</span> {q}
                </li>
              ))}
            </ol>
          </div>

          {/* Objections */}
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-chalk-100"><ShieldAlert size={15} /> Questions they may raise</h2>
            <ul className="space-y-1.5">
              {meeting.likelyObjections.map((o, i) => (
                <li key={i} className="text-sm text-chalk-300">• {o}</li>
              ))}
            </ul>
          </div>

          {/* Notes */}
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-chalk-100">Meeting notes</h2>
            <form action={updateMeetingNotesAction.bind(null, meeting.id, lead.id)} className="space-y-2">
              <textarea name="notes" defaultValue={meeting.notes} rows={6} placeholder="Notes from the conversation…" className="input text-sm" />
              <label className="block"><span className="field-label">Next step</span><input name="nextStep" defaultValue={meeting.nextStep} className="input" placeholder="e.g. Send proposal by Friday" /></label>
              <button type="submit" className="btn-secondary text-xs">Save notes</button>
            </form>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-chalk-100">Brief & context</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-chalk-500">Likely direction</dt><dd className="text-right text-chalk-200">{lead.recommendedService ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-chalk-500">Investment range</dt><dd className="text-chalk-200">{formatRange(lead.estimatedValueLow, lead.estimatedValueHigh)}</dd></div>
              <div className="flex justify-between"><dt className="text-chalk-500">Opportunity score</dt><dd className="text-chalk-200">{lead.leadScore ?? "—"}/100</dd></div>
            </dl>
            <div className="mt-3 flex flex-col gap-2">
              <Link href={`/conversation/${lead.id}`} className="btn-primary text-xs">Enter conversation mode</Link>
              <Link href={`/leads/${lead.id}/discovery`} className="btn-secondary text-xs">Discovery workspace</Link>
              <Link href={`/leads/${lead.id}`} className="btn-secondary text-xs">Open full business</Link>
              {deliverable && <a href={`/api/deliverable/${deliverable.id}/pdf`} target="_blank" rel="noreferrer" className="btn-secondary text-xs">View Modernization Brief</a>}
              {video?.videoUrl && <a href={video.videoUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">Watch sent video</a>}
            </div>
          </div>

          {findings.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-chalk-100">Key findings</h2>
              <ul className="space-y-1.5 text-sm text-chalk-300">
                {findings.map((f) => <li key={f.id}>• {f.title}</li>)}
              </ul>
            </div>
          )}

          {priorOutreach.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-chalk-100">Previous outreach</h2>
              {priorOutreach.map((o) => (
                <p key={o.id} className="text-xs text-chalk-400">{shortDate(o.sentAt)} · {o.channel} · {o.subject}</p>
              ))}
            </div>
          )}

          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-chalk-100">Outcome</h2>
            <MeetingOutcome meetingId={meeting.id} leadId={lead.id} current={meeting.outcome} />
          </div>
        </div>
      </div>
    </div>
  );
}

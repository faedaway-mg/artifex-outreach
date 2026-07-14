"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Check, Copy, Send, MessageSquareReply, Ban, PenLine } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import {
  generateOutreachAction,
  updateOutreachAction,
  approveOutreachAction,
  markOutreachSentAction,
  markRepliedAction,
  optOutAction,
} from "@/lib/actions";
import { OUTREACH_CHANNELS, type Lead, type Outreach, type Contact, type Settings, type OutreachChannel } from "@/lib/types";

export function OutreachPanel({
  lead,
  outreach,
  contacts,
  settings,
}: {
  lead: Lead;
  outreach: Outreach[];
  contacts: Contact[];
  settings: Settings;
  hasVideo: boolean;
  hasBrief: boolean;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const draft = outreach.at(-1);
  const contact = contacts[0];
  const [copied, setCopied] = useState(false);

  const gmailLink = draft
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(contact?.email ?? lead.publicEmail ?? "")}&su=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`
    : "#";

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-chalk-100">Outreach message</h2>
          <p className="text-xs text-chalk-500">Personalized, low-pressure. Nothing sends without your approval.</p>
        </div>
        {draft && <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs capitalize text-chalk-400">{draft.status}{draft.responseStatus !== "none" ? ` · ${draft.responseStatus}` : ""}</span>}
      </div>

      {!draft ? (
        <ActionButton variant="primary" onRun={() => generateOutreachAction(lead.id).then(refresh)}>
          <PenLine size={15} /> Draft outreach message
        </ActionButton>
      ) : (
        <div className="space-y-4">
          {draft.status !== "sent" ? (
            <form action={updateOutreachAction.bind(null, draft.id, lead.id)} onSubmit={() => setTimeout(refresh, 300)} className="space-y-2">
              <label className="block"><span className="field-label">Subject</span><input name="subject" defaultValue={draft.subject} className="input" /></label>
              <label className="block"><span className="field-label">Message</span><textarea name="body" defaultValue={draft.body} rows={12} className="input text-sm leading-relaxed" /></label>
              <button type="submit" className="btn-secondary text-xs"><PenLine size={13} /> Save draft</button>
            </form>
          ) : (
            <div className="rounded-lg border border-white/[0.06] p-3">
              <p className="text-sm font-medium text-chalk-200">{draft.subject}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-chalk-300">{draft.body}</pre>
            </div>
          )}

          {/* Approval + send */}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
            {draft.status === "draft" && (
              <ActionButton variant="primary" onRun={() => approveOutreachAction(draft.id, lead.id).then(refresh)}>
                <Check size={15} /> Approve message
              </ActionButton>
            )}
            {draft.status === "approved" && (
              <>
                <a href={gmailLink} target="_blank" rel="noreferrer" className="btn-secondary"><Mail size={15} /> Open in Gmail</a>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="btn-secondary"
                >
                  <Copy size={15} /> {copied ? "Copied" : "Copy"}
                </button>
                <MarkSent leadId={lead.id} outreachId={draft.id} onDone={refresh} />
              </>
            )}
            {draft.status === "sent" && (
              <>
                <span className="text-xs text-emerald-300">✓ Sent {draft.sentAt ? new Date(draft.sentAt).toLocaleDateString() : ""} via {draft.channel}. Follow-up sequence scheduled.</span>
                <div className="flex gap-2">
                  <ActionButton variant="secondary" onRun={() => markRepliedAction(lead.id).then(refresh)}>
                    <MessageSquareReply size={14} /> Lead replied
                  </ActionButton>
                  <ActionButton variant="danger" confirm="Opt this contact out and add to suppression list?" onRun={() => optOutAction(lead.id).then(refresh)}>
                    <Ban size={14} /> Opt out
                  </ActionButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MarkSent({ leadId, outreachId, onDone }: { leadId: string; outreachId: string; onDone: () => void }) {
  const [channel, setChannel] = useState<OutreachChannel>("email");
  return (
    <div className="flex items-center gap-2">
      <select value={channel} onChange={(e) => setChannel(e.target.value as OutreachChannel)} className="input !w-auto !py-1.5 text-xs">
        {OUTREACH_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <ActionButton variant="primary" onRun={() => markOutreachSentAction(outreachId, leadId, channel).then(onDone)}>
        <Send size={14} /> Mark as sent
      </ActionButton>
    </div>
  );
}

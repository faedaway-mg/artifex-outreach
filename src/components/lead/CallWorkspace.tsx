// The Call First workspace — one unified "Call this business" action. There is no
// Next Best Action card, no Primary Contact Strategy card, no separate phone guide
// and no email drafting competing with it: everything the operator needs to make
// the call and record it lives here, and nothing else does. What renders is driven
// by the lead's single contact state (see deriveCallLeadState) — call-required,
// attempt-scheduled, or closed.
import { Phone, MapPin, Globe, Target, CheckCircle2, CalendarClock, XCircle } from "lucide-react";
import { CallSessionShell } from "@/components/lead/CallSessionShell";
import { CallOutcomeConsole, type Continuation } from "@/components/lead/CallOutcomeConsole";
import { ResetLeadButton } from "@/components/lead/ResetLeadButton";
import { ConvertToSendButton } from "@/components/lead/ConvertToSendButton";
import { WebsiteLink } from "@/components/WebsiteLink";
import { PhoneCopyButton } from "@/components/PhoneCopyButton";
import type { CallScript } from "@/lib/outreach/contact-strategy";
import { openingForLead } from "@/lib/outreach/call-opening";
import type { CallLeadState } from "@/lib/outreach/call-state";
import { deslug } from "@/lib/utils";
import type { Lead } from "@/lib/types";

// What every call must come home with — the whole reason to dial. Kept as a short,
// glanceable checklist so the operator knows what to listen for.
const COLLECT = ["Decision-maker name", "Their role", "Best email address", "Permission to send it over"];

function Identity({ lead, reason }: { lead: Lead; reason: string }) {
  return (
    <div className="card p-5">
      <h1 className="text-2xl font-semibold text-chalk-50">{lead.businessName}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-chalk-400">
        <span>{deslug(lead.industry)}</span>
        <span className="inline-flex items-center gap-1"><MapPin size={14} /> {lead.city}</span>
        {lead.phone && (
          <span className="inline-flex items-center gap-0.5 text-chalk-200">
            <Phone size={14} aria-hidden /> {lead.phone}
            <PhoneCopyButton phone={lead.phone} businessName={lead.businessName} className="ml-0.5" />
          </span>
        )}
        {lead.website ? (
          <WebsiteLink url={lead.website} domain={lead.websiteDomain} businessName={lead.businessName} />
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-300/90"><Globe size={14} aria-hidden /> No website</span>
        )}
      </div>
      <p className="mt-3 border-t border-white/[0.06] pt-3 text-[13.5px] leading-relaxed text-chalk-300">{reason}</p>
    </div>
  );
}

export function CallWorkspace({
  lead,
  script,
  reason,
  state,
  continuation,
  collectedEmail,
  observation,
}: {
  lead: Lead;
  script: CallScript;
  reason: string;
  state: CallLeadState;
  /** The strongest concrete thing we noticed — it makes the offer real on the phone. */
  observation?: string | null;
  /** Batch/queue context so the outcome card can offer "Next lead". */
  continuation?: Continuation;
  /** An email collected on a call (on a contact) while the lead still has no send
   *  route — enables the one-tap "they asked us to send it" correction. */
  collectedEmail?: string | null;
}) {
  // CLOSED — the lead is done. No call button, no script: one calm status card and
  // the ability to reopen if it was a mistake. Deeper info still lives below.
  if (state.kind === "closed") {
    return (
      <div className="space-y-5">
        <Identity lead={lead} reason={reason} />
        <section className="card p-5">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-chalk-100">
            <XCircle size={16} className="text-coral-300" /> Lead closed — {state.label}
          </p>
          <p className="mt-1.5 text-[13px] text-chalk-400">
            No further outreach is queued for this business. Its research and history remain below.
          </p>
          {/* Accidental terminal tap recovery — the clear, explicit way to undo a mistaken
              close (e.g. "Permanently closed" when you meant "Closed right now"). */}
          <div className="mt-4">
            <ResetLeadButton leadId={lead.id} />
          </div>
          <div className="mt-3">
            <CallOutcomeConsole leadId={lead.id} collapsedLabel="Or log a different outcome" />
          </div>
        </section>
      </div>
    );
  }

  const scheduled = state.kind === "attempt-scheduled" ? state : null;

  // The words for THIS business, reasoned from what it is and what we found —
  // built once here so the live assistant and the written guide below it are the
  // same call, not two different ones (see call-opening.ts).
  const opening = openingForLead(lead, { observations: [observation] });

  return (
    <div className="space-y-5">
      {/* 1 · COMPACT IDENTITY — name, category, city, phone, website status, one reason. */}
      <Identity lead={lead} reason={reason} />

      {/* If an attempt is already logged, say so plainly and name the next attempt —
          the one action is still "call", just now framed as calling again. */}
      {scheduled && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-azure-400/20 bg-azure-400/[0.05] px-4 py-3 text-[13px]">
          <CalendarClock size={15} className="text-azure-300" />
          <span className="font-medium text-chalk-100">Attempt recorded.</span>
          <span className="text-chalk-400">Next attempt {new Date(scheduled.at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}.</span>
          {scheduled.lastResult && <span className="w-full text-[12px] text-chalk-500">Last result: {scheduled.lastResult}</span>}
          {/* Correction path: an email was collected but the logged outcome scheduled
              another call. If they actually asked us to send it, one tap converts
              it — the send is queued, the call-back superseded, history kept. */}
          {collectedEmail && <ConvertToSendButton leadId={lead.id} email={collectedEmail} />}
        </div>
      )}

      {/* 2 · THE CALL ACTION + 3 · THE LIVE ASSISTANT — side by side on desktop so
          both the call button and the words to say are in the first viewport. The
          assistant and the outcome console share one session (see CallSessionShell),
          so what the operator taps during the call becomes what gets recorded after it. */}
      <CallSessionShell
        leadId={lead.id}
        businessName={lead.businessName}
        opening={opening}
        script={script}
        continuation={continuation}
        aside={
          <section className="card p-5">
            <p className="eyebrow text-azure-300">Next action</p>
            <h2 className="mt-1 text-lg font-semibold text-chalk-50">{scheduled ? "Call again" : "Call the business"}</h2>
            <p className="mt-2 flex gap-2 text-[13.5px] leading-relaxed text-chalk-300">
              <Target size={15} className="mt-0.5 shrink-0 text-amber-300" />
              <span>{script.objective}</span>
            </p>
            {lead.phone ? (
              <>
                <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${lead.businessName} at ${lead.phone}`} className="btn-primary mt-4 w-full justify-center !py-3.5 text-[16px]">
                  <Phone size={18} aria-hidden /> Call {lead.phone}
                </a>
                {/* Secondary path — copy the number to paste into Google Voice. */}
                <div className="mt-2">
                  <PhoneCopyButton phone={lead.phone} businessName={lead.businessName} variant="button" />
                </div>
              </>
            ) : (
              <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-[13px] text-chalk-500">
                No phone number on file yet — find a number or booking link before the call.
              </p>
            )}

            {/* What I need from this call — the point of dialing. */}
            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">What I need from this call</p>
              <ul className="mt-1.5 space-y-1">
                {COLLECT.map((c) => (
                  <li key={c} className="flex items-center gap-2 text-[13px] text-chalk-300">
                    <CheckCircle2 size={13} className="shrink-0 text-chalk-600" /> {c}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        }
      />
    </div>
  );
}

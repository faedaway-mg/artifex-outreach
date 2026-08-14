"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Email decision — review, EDIT, approve & send, then the next business loads.
//
// The operator sees who, why, what stood out, the recipient, and the exact subject +
// body — both editable inline. What they see and edit here IS what sends (WYSIWYS):
// the edited plaintext is folded into the server render, so no hidden regeneration can
// change the message after approval. One tap sends; the next email appears. Built to be
// worked from a phone in the 60 seconds before a DoorDash pickup.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check, ArrowRight, AlertTriangle, Clock, Mail, Paperclip } from "lucide-react";
import { sendIntroductionAction, sendFollowUpAction } from "@/lib/outreach/send-actions";
import { completeTaskAction } from "@/lib/actions";

export interface EmailDecisionProps {
  leadId: string;
  mode: "intro" | "followup";
  business: string;
  industry: string;
  contact: string;
  /** The address the email will actually go to — shown so the operator confirms the route. */
  recipient: string;
  why: string;
  observations: string[];
  subject: string;
  openingSentence: string;
  readingLabel: string;
  fullParagraphs: string[];
  /** The actual branded email HTML — shown on expand so the operator approves the real thing. */
  html?: string;
  /** The attached one-page Artifex Quick Review — filename + a preview URL (initial emails only). */
  attachmentName?: string | null;
  attachmentHref?: string | null;
  /** False when the initial email's Quick Review isn't ready — send is withheld until it is. */
  reviewReady?: boolean;
  taskId: string | null;
  nextHref: string;
  isLast: boolean;
  /** Present on projected follow-ups — read from the authoritative acquisition step. */
  sequence?: {
    followUpNumber: number;
    totalFollowUps: number;
    priorSentAt: string | null;
    daysSincePriorTouch: number | null;
    nextScheduledAt: string | null;
  } | null;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function EmailDecision(p: EmailDecisionProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  // The editable message. Defaults are the generated draft; whatever is here at send
  // time is exactly what goes out (folded into the server render).
  const [subject, setSubject] = useState(p.subject);
  const [body, setBody] = useState(p.fullParagraphs.join("\n\n"));
  const edited = subject !== p.subject || body !== p.fullParagraphs.join("\n\n");
  // The business this editor was mounted for. Captured at mount alongside the draft state, so if
  // this instance were ever reused across a business switch (stale render), the id travels with
  // the stale subject/body and the SERVER fails the send closed rather than mixing businesses.
  const [previewBusinessId] = useState(p.leadId);

  const advance = (complete: boolean) =>
    start(async () => {
      if (complete && p.taskId) await completeTaskAction(p.taskId);
      router.push(p.nextHref);
    });

  const approveSend = () =>
    start(async () => {
      if (pending) return; // a double-tap can't fire a second send (also idempotent server-side)
      const override = { subject, body, previewBusinessId };
      const res = p.mode === "followup"
        ? await sendFollowUpAction(p.leadId, override)
        : await sendIntroductionAction(p.leadId, null, override);
      if (res.outcome === "sent" || res.outcome === "queued") {
        if (p.taskId) await completeTaskAction(p.taskId);
        router.push(p.nextHref);
      } else {
        setNote(res.reason ?? "Couldn't send right now.");
      }
    });

  return (
    <div className="space-y-4">
      <section className="card p-5 sm:p-6">
        <p className="text-[12px] text-chalk-500">{p.mode === "followup" ? "Follow up with" : "Approve the email to"}</p>
        <h1 className="mt-0.5 text-[1.35rem] font-semibold leading-tight tracking-[-0.01em] text-chalk-50">{p.business}</h1>
        <p className="mt-0.5 text-[12.5px] text-chalk-500">{[p.industry, p.contact].filter(Boolean).join(" · ")}</p>

        {/* Where this touch sits in the real sequence — so the operator never has
            to remember dates or count touches. Read from the authoritative step. */}
        {p.sequence && (
          <p className="mt-2 text-[12px] text-chalk-500">
            {[
              `Follow-up ${p.sequence.followUpNumber} of ${p.sequence.totalFollowUps}`,
              p.sequence.daysSincePriorTouch !== null && p.sequence.priorSentAt
                ? `last touch ${shortDate(p.sequence.priorSentAt)} · ${p.sequence.daysSincePriorTouch}d ago`
                : null,
              p.sequence.nextScheduledAt ? `next scheduled ${shortDate(p.sequence.nextScheduledAt)}` : "last in the sequence",
            ].filter(Boolean).join(" · ")}
          </p>
        )}

        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Why we're reaching out</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-300">{p.why}</p>
        </div>

        {p.observations.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">What stood out</p>
            <ul className="mt-1 space-y-1">
              {p.observations.map((o, i) => <li key={i} className="flex gap-2 text-[13px] text-chalk-300"><span className="mt-0.5 text-amber-300">→</span><span>{o}</span></li>)}
            </ul>
          </div>
        )}

        {/* Recipient — confirm the route before anything sends. */}
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <Mail size={14} className="shrink-0 text-chalk-500" />
          <span className="text-[11px] uppercase tracking-wide text-chalk-500">To</span>
          <span className="truncate text-[13px] text-chalk-100">{p.recipient}</span>
        </div>

        {/* The message — editable inline. What is here at send time IS what sends. */}
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-[16px] text-chalk-100 focus:border-azure-400/40 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-ink-950/40 px-3 py-2.5 text-[15px] leading-relaxed text-chalk-200 focus:border-azure-400/40 focus:outline-none"
            />
          </label>
          <p className="inline-flex items-center gap-1 text-[11px] text-chalk-600">
            <Clock size={11} /> {p.readingLabel} · your signature + an unsubscribe link are added automatically
          </p>
          {/* Branded styling reference — only shown before edits, so it can never
              disagree with what actually sends. After an edit, the fields above are the
              single source of truth. */}
          {p.html && !edited && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[11.5px] text-amber-300/90 hover:text-amber-300">
                <ChevronDown size={13} className="transition-transform group-open:rotate-180" /> Preview branded styling
              </summary>
              <iframe title="Branded email preview" sandbox="" srcDoc={p.html} className="mt-2 w-full rounded-md border border-white/10 bg-white" style={{ height: 520 }} />
            </details>
          )}
          {edited && <p className="text-[11px] text-teal-300/90">Edited — your version is what will send.</p>}
        </div>

        {/* Review not ready → withhold sending; never claim an attachment that isn't there. */}
        {p.reviewReady === false && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <p className="text-[13px] font-medium text-amber-200">Review needs attention</p>
              <p className="mt-0.5 text-[12px] text-chalk-400">No credible findings yet, so there's nothing to attach. Sending is paused for this business.</p>
            </div>
          </div>
        )}

        {/* The attached one-page Quick Review — what the recipient opens. Never buried. */}
        {p.attachmentName && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <Paperclip size={14} className="shrink-0 text-chalk-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-wide text-chalk-500">Attached review</p>
              <p className="truncate text-[13px] text-chalk-100">{p.attachmentName}</p>
            </div>
            {p.attachmentHref && (
              <a href={p.attachmentHref} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-azure-200 hover:border-white/20">Preview review</a>
            )}
          </div>
        )}

        {note && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-2.5 text-[12.5px] text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {note}
          </p>
        )}
      </section>

      {/* Primary actions — always visible, no scrolling to reach them. Focus mode has no
          bottom nav, so the sticky bar sits just above the viewport edge. */}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)_+_1rem)] z-10 space-y-2 md:static md:bottom-auto">
        <button onClick={approveSend} disabled={pending || p.reviewReady === false} className="btn-primary w-full justify-center !py-3 text-[15px] disabled:opacity-50">
          <Check size={17} /> {p.reviewReady === false ? "Review needs attention" : pending ? "Sending…" : note ? "Try send again" : edited ? "Approve & send edited" : "Approve & send"} <ArrowRight size={16} />
        </button>
        <div className="flex gap-2">
          {note
            ? <button onClick={() => advance(false)} disabled={pending} className="btn-ghost flex-1 justify-center !py-2.5 text-[13.5px]">Next anyway <ArrowRight size={14} /></button>
            : <button onClick={() => advance(false)} disabled={pending} className="btn-ghost flex-1 justify-center !py-2.5 text-[13.5px]">Skip</button>}
        </div>
      </div>
    </div>
  );
}

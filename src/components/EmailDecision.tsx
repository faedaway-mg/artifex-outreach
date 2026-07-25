"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Email decision — decide whether to send, don't re-read the whole email.
//
// The operator sees who, why (two lines), what stood out, and a one-line summary of
// the message (subject + opening + read time). The full email is collapsed behind
// "Expand email" — supporting documentation, not the interface. One tap approves and
// sends, then the next business loads. No scrolling to find the buttons.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check, Pencil, ArrowRight, AlertTriangle, Clock } from "lucide-react";
import { sendIntroductionAction, sendFollowUpAction } from "@/lib/outreach/send-actions";
import { completeTaskAction } from "@/lib/actions";

export interface EmailDecisionProps {
  leadId: string;
  mode: "intro" | "followup";
  business: string;
  industry: string;
  contact: string;
  why: string;
  observations: string[];
  subject: string;
  openingSentence: string;
  readingLabel: string;
  fullParagraphs: string[];
  /** The actual branded email HTML — shown on expand so the operator approves the real thing. */
  html?: string;
  taskId: string | null;
  nextHref: string;
  isLast: boolean;
}

export function EmailDecision(p: EmailDecisionProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const advance = (complete: boolean) =>
    start(async () => {
      if (complete && p.taskId) await completeTaskAction(p.taskId);
      router.push(p.nextHref);
    });

  const approveSend = () =>
    start(async () => {
      const res = p.mode === "followup" ? await sendFollowUpAction(p.leadId) : await sendIntroductionAction(p.leadId);
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

        {/* The email itself — a one-line summary; the full text is documentation. */}
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[13px] font-medium text-chalk-100">{p.subject}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-chalk-400">“{p.openingSentence}”</p>
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-chalk-600"><Clock size={11} /> {p.readingLabel} · founder voice, low-pressure</p>
          <details className="group mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[11.5px] text-amber-300/90 hover:text-amber-300">
              <ChevronDown size={13} className="transition-transform group-open:rotate-180" /> Expand email
            </summary>
            {p.html ? (
              // The real branded email — exactly what the prospect receives.
              <iframe title="Branded email preview" sandbox="" srcDoc={p.html} className="mt-2 w-full rounded-md border border-white/10 bg-white" style={{ height: 520 }} />
            ) : (
              <div className="mt-2 space-y-2 border-t border-white/[0.06] pt-2">
                {p.fullParagraphs.map((para, i) => <p key={i} className="text-[13px] leading-relaxed text-chalk-300">{para}</p>)}
              </div>
            )}
          </details>
        </div>

        {note && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-2.5 text-[12.5px] text-amber-200">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {note}
          </p>
        )}
      </section>

      {/* Primary actions — always visible, no scrolling to reach them. Focus mode has no
          bottom nav, so the sticky bar sits just above the viewport edge. */}
      <div className="sticky bottom-4 z-10 space-y-2 md:static md:bottom-auto">
        <button onClick={approveSend} disabled={pending} className="btn-primary w-full justify-center !py-3 text-[15px] disabled:opacity-60">
          <Check size={17} /> {note ? "Try send again" : "Approve & send"} <ArrowRight size={16} />
        </button>
        <div className="flex gap-2">
          <button onClick={() => router.push(`/leads/${p.leadId}/send`)} disabled={pending} className="btn-secondary flex-1 justify-center !py-2.5 text-[13.5px]"><Pencil size={14} /> Edit</button>
          {note
            ? <button onClick={() => advance(false)} disabled={pending} className="btn-ghost flex-1 justify-center !py-2.5 text-[13.5px]">Next anyway <ArrowRight size={14} /></button>
            : <button onClick={() => advance(false)} disabled={pending} className="btn-ghost flex-1 justify-center !py-2.5 text-[13.5px]">Skip</button>}
        </div>
      </div>
    </div>
  );
}

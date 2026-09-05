"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, PauseCircle, Flag, Loader2, Check, ArrowRight } from "lucide-react";
import { holdProspectAction, flagForManualFollowUpAction } from "@/lib/outreach/attention-actions";
import type { AttentionAck } from "@/lib/outreach/attention-status";

export interface AttentionCardProps {
  leadId: string; business: string; reason: string; ack: AttentionAck;
}

// A NEEDS_ATTENTION recovery card with exactly TWO safe, non-sending choices (mandate 15 Part 3). Neither
// sends email nor changes canonical lifecycle state; each records operator intent and shows the result.
export function AttentionCard({ leadId, business, reason, ack: initialAck }: AttentionCardProps) {
  const [pending, start] = useTransition();
  const [ack, setAck] = useState<AttentionAck>(initialAck);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "hold" | "flag">(null);

  function run(kind: "hold" | "flag") {
    setError(null);
    start(async () => {
      try {
        const r = kind === "hold" ? await holdProspectAction(leadId) : await flagForManualFollowUpAction(leadId);
        if ((r as { ok: boolean }).ok) { setAck(kind === "hold" ? "held" : "flagged"); setConfirming(null); }
        else { setError((r as { reason?: string }).reason ?? "Action failed."); }
      } catch (e) { setError((e as Error)?.message?.slice(0, 120) ?? "Action failed."); }
    });
  }

  return (
    <div className="rounded-2xl border border-coral-400/20 bg-coral-400/[0.04] p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-coral-300" />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-chalk-50">{business}</div>
          <p className="mt-0.5 text-[13px] leading-snug text-chalk-300">A previous email has already been sent, and your completed video is ready. Choose whether to hold it or flag it for a manual follow-up decision.</p>
          <p className="mt-1 text-[12px] text-chalk-500">{reason}</p>
        </div>
      </div>

      {ack ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-200">
          <Check size={14} className="text-teal-300" /> {ack === "held" ? "Held — removed from Needs attention. Nothing was sent." : "Flagged for a manual follow-up decision. Nothing was sent or scheduled."}
          <Link href={`/company/${leadId}`} className="ml-auto inline-flex items-center gap-1 text-[12px] text-chalk-400 hover:text-chalk-200">View <ArrowRight size={12} /></Link>
        </div>
      ) : confirming ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p className="text-[13px] text-chalk-200">{confirming === "hold"
            ? "Hold this package: it will be marked held and removed from Needs attention. No email is sent."
            : "Flag for a manual follow-up decision: records that you'll decide later. No email is sent or scheduled."}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => run(confirming)} disabled={pending} className="btn-primary text-sm disabled:opacity-50">{pending ? <><Loader2 size={14} className="animate-spin" /> Working…</> : "Confirm"}</button>
            <button onClick={() => setConfirming(null)} disabled={pending} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setConfirming("hold")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-100 transition-colors hover:bg-white/[0.06]"><PauseCircle size={14} /> Hold package</button>
          <button onClick={() => setConfirming("flag")} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-100 transition-colors hover:bg-white/[0.06]"><Flag size={14} /> Flag for follow-up</button>
        </div>
      )}
      {error && <p className="mt-2 flex items-center gap-1 text-[12.5px] text-coral-200"><AlertTriangle size={13} /> {error}</p>}
    </div>
  );
}

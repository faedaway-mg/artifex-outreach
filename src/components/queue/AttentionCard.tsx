"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, PauseCircle, Video, Loader2, Check, ArrowRight } from "lucide-react";
import { holdProspectAction, prepareVideoFollowUpAction } from "@/lib/outreach/attention-actions";
import type { AttentionAck } from "@/lib/outreach/attention-status";
import type { NeedsAttentionReason } from "@/lib/outreach/attention-reasons";
import { NEEDS_ATTENTION_ACTIONS } from "@/lib/outreach/attention-reasons";
import { RejectControl } from "./RejectControl";

export interface AttentionCardProps {
  leadId: string; business: string; reason: string; ack: AttentionAck;
  reasonCode?: NeedsAttentionReason;
  contacted?: boolean;
}

// NEEDS_ATTENTION recovery card (mandate 24). Shows the REAL reason and ONLY the actions valid for it.
// The Morris-style case (prior-sent-video-undelivered) offers exactly: Prepare video follow-up, Hold
// company, and the canonical Reject/Stop control. Each action explains its effect and confirms before
// mutating; Cancel mutates nothing; success updates the queue; nothing is ever sent or scheduled here.
export function AttentionCard({ leadId, business, reason, ack: initialAck, reasonCode = "unknown", contacted = true }: AttentionCardProps) {
  const [pending, start] = useTransition();
  const [ack, setAck] = useState<AttentionAck>(initialAck);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "prepare" | "hold">(null);

  const allowed = NEEDS_ATTENTION_ACTIONS[reasonCode] ?? ["hold", "reject"];
  const canPrepare = allowed.includes("prepare-video-follow-up");
  const canHold = allowed.includes("hold");
  const canReject = allowed.includes("reject");

  const EFFECT: Record<"prepare" | "hold", string> = {
    prepare: "Creates ONE reviewable video follow-up (Ready to Approve). Nothing is approved, scheduled, or sent. The prior send + completed video are preserved.",
    hold: "Removes this company from Needs attention and preserves its package, video, and prior receipt. Nothing is scheduled or sent. You can resume it later. Not a rejection.",
  };

  function run(kind: "prepare" | "hold") {
    setError(null);
    start(async () => {
      try {
        if (kind === "prepare") {
          const r = await prepareVideoFollowUpAction(leadId);
          if (r.ok) { setDone(r.alreadyPrepared ? "Follow-up already prepared — in Ready to Approve." : "Video follow-up prepared — now in Ready to Approve. Nothing was sent."); setConfirming(null); }
          else if (r.alreadyDelivered) { setError("This video was already delivered — no follow-up needed. Hold or reject instead."); setConfirming(null); }
          else setError(r.reason ?? "Could not prepare a follow-up.");
        } else {
          const r = await holdProspectAction(leadId);
          if ((r as { ok: boolean }).ok) { setAck("held"); setDone("Held — removed from Needs attention. Nothing was sent. You can resume later."); setConfirming(null); }
          else setError((r as { reason?: string }).reason ?? "Could not hold.");
        }
      } catch (e) { setError((e as Error)?.message?.slice(0, 140) ?? "Action failed."); }
    });
  }

  return (
    <div className="rounded-2xl border border-coral-400/20 bg-coral-400/[0.04] p-4" data-attention-card data-reason-code={reasonCode}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-coral-300" />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-chalk-50">{business}</div>
          <p className="mt-0.5 text-[13px] leading-snug text-chalk-300" data-attention-reason>{reason}</p>
        </div>
      </div>

      {done ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-200" data-attention-done>
          <Check size={14} className="text-teal-300" /> {done}
          <Link href={`/company/${leadId}?from=attention`} className="ml-auto inline-flex items-center gap-1 text-[12px] text-chalk-400 hover:text-chalk-200">View <ArrowRight size={12} /></Link>
        </div>
      ) : ack === "held" ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-200"><Check size={14} className="text-teal-300" /> Held — removed from Needs attention. Nothing was sent.</div>
      ) : confirming ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3" data-attention-confirm>
          <p className="text-[13px] text-chalk-200">{EFFECT[confirming]}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => run(confirming)} disabled={pending} data-attention-confirm-yes className="btn-primary text-sm disabled:opacity-50">{pending ? <><Loader2 size={14} className="animate-spin" /> Working…</> : "Confirm"}</button>
            <button onClick={() => setConfirming(null)} disabled={pending} data-attention-cancel className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {canPrepare && <button onClick={() => setConfirming("prepare")} data-action-prepare className="inline-flex items-center gap-1.5 rounded-lg border border-teal-400/30 bg-teal-400/10 px-3 py-2 text-[13px] text-teal-100 transition-colors hover:bg-teal-400/15"><Video size={14} /> Prepare video follow-up</button>}
          {canHold && <button onClick={() => setConfirming("hold")} data-action-hold className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-100 transition-colors hover:bg-white/[0.06]"><PauseCircle size={14} /> Hold company</button>}
          {canReject && <RejectControl leadId={leadId} contacted={contacted} />}
        </div>
      )}
      {error && <p className="mt-2 flex items-center gap-1 text-[12.5px] text-coral-200" data-attention-error><AlertTriangle size={13} /> {error}</p>}
    </div>
  );
}

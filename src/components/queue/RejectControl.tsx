"use client";
import { useState, useTransition } from "react";
import { Ban, Check, Loader2, AlertTriangle, X } from "lucide-react";
import { rejectLeadAction } from "@/lib/outreach/reject-actions";
import { REJECTION_REASONS, REJECTION_REASON_LABEL, type RejectionReason } from "@/lib/outreach/rejection-core";

// THE single Reject / Stop-future-outreach control (mandate 21). Reused across EVERY operator surface
// (Needs Evidence, Needs Voiceover, Rendering, Needs Attention, Ready to Approve, Scheduled-if-unsent, Full
// Package, and the company/detail view) so one deliberate action removes a poor-fit company from the active
// pipeline. It labels itself "Reject" for an unsent company and "Stop future outreach" for one already
// contacted, requires an explicit reason + confirmation before committing, and truthfully reports what
// happened — never claiming the recipient opted out. It calls the canonical rejectLeadAction only.
export function RejectControl({
  leadId, contacted = false, onRejected, className, size = "sm",
}: {
  leadId: string;
  contacted?: boolean;
  onRejected?: () => void;
  className?: string;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<null | { ok: boolean; lines: string[] }>(null);

  const label = contacted ? "Stop future outreach" : "Reject";
  const textCls = size === "xs" ? "text-[11.5px]" : "text-[12.5px]";

  function confirm() {
    if (pending || !reason) return;
    start(async () => {
      try {
        const r = await rejectLeadAction({ leadId, reason, note: note.trim() || null });
        if (!r.ok) { setDone({ ok: false, lines: [r.error ?? "Could not reject."] }); return; }
        // Truthful confirmation states (mandate 21) — reflect what actually happened.
        const lines: string[] = ["Removed from active queues"];
        if (r.cancelledBinding) lines.push("Cancelled pending scheduled outreach");
        if (r.stoppedPlans > 0) lines.push(`Cancelled ${r.stoppedPlans} pending follow-up${r.stoppedPlans === 1 ? "" : "s"}`);
        lines.push("Future automated outreach prevented");
        lines.push(r.sent ? "Delivered email + receipt preserved" : "History preserved");
        setOpen(false);
        setDone({ ok: true, lines });
        onRejected?.();
      } catch (e) {
        setDone({ ok: false, lines: [(e as Error)?.message?.slice(0, 140) ?? "Reject failed."] });
      }
    });
  }

  if (done?.ok) {
    return (
      <div className={className}>
        <div className={`flex items-start gap-1.5 text-teal-200 ${textCls}`}>
          <Check size={13} className="mt-0.5 shrink-0" />
          <span>{contacted ? "Future outreach stopped" : "Rejected"} — {done.lines.join(" · ")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {!open ? (
        <button
          type="button"
          onClick={() => { setDone(null); setOpen(true); }}
          disabled={pending}
          className={`inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 ${textCls} text-chalk-300 hover:text-coral-200 hover:border-coral-400/30 disabled:opacity-50`}
          data-reject-control
          data-reject-label={label}
        >
          <Ban size={13} /> {label}
        </button>
      ) : (
        <div className="rounded-lg border border-coral-400/30 bg-black/20 p-3 max-w-sm" data-reject-panel>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-chalk-100">{label} — pick a reason</span>
            <button type="button" onClick={() => setOpen(false)} className="text-chalk-500 hover:text-chalk-300" aria-label="Cancel"><X size={14} /></button>
          </div>
          <div className="flex flex-col gap-1">
            {REJECTION_REASONS.map((r) => (
              <label key={r} className={`flex items-center gap-2 rounded px-1.5 py-1 ${textCls} cursor-pointer ${reason === r ? "bg-white/5 text-chalk-100" : "text-chalk-300 hover:bg-white/5"}`}>
                <input type="radio" name={`reject-${leadId}`} value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-coral-400" data-reject-reason={r} />
                {REJECTION_REASON_LABEL[r]}
              </label>
            ))}
          </div>
          {reason === "other" && (
            <input
              type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
              placeholder="Short note (optional)"
              className={`mt-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 ${textCls} text-chalk-100 placeholder:text-chalk-600`}
              data-reject-note
            />
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button" onClick={confirm} disabled={pending || !reason}
              className="inline-flex items-center gap-1.5 rounded-md bg-coral-500/90 px-3 py-1 text-[12.5px] font-medium text-white hover:bg-coral-500 disabled:opacity-40"
              data-reject-confirm
            >
              {pending ? <><Loader2 size={13} className="animate-spin" /> Removing…</> : <>Confirm — {label.toLowerCase()}</>}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className="text-[12.5px] text-chalk-400 hover:text-chalk-200">Cancel</button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-chalk-500">
            Removes the company from active queues and prevents future automated outreach. History is preserved; the recipient is <span className="text-chalk-300">not</span> marked as unsubscribed.
          </p>
        </div>
      )}
      {done && !done.ok && (
        <span className={`mt-1 flex items-center gap-1 text-coral-200 ${textCls}`}><AlertTriangle size={13} /> {done.lines[0]}</span>
      )}
    </div>
  );
}

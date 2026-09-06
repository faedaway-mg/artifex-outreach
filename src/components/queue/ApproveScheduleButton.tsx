"use client";
import { useState, useTransition } from "react";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { approveAndScheduleSelectedAction } from "@/lib/outreach/batch-actions";

// THE single Approve-&-schedule control (mandate 20). Used by BOTH the Ready-to-Approve card and the Full
// Package view so they invoke the SAME canonical domain operation (approveAndScheduleSelectedAction: freeze
// the exact revision → schedule exactly one binding). Success is shown ONLY after the operation confirms the
// lead was actually scheduled; a partial/failed result shows an actionable error and never says "Approved".
// Idempotent: the underlying freeze + schedule de-dupe, so a double-tap converges to one binding.
export function ApproveScheduleButton({ leadId, onApproved, className }: { leadId: string; onApproved?: () => void; className?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<null | { ok: boolean; msg: string }>(null);

  function approve() {
    if (pending || result?.ok) return; // guard against double-tap on the client too
    start(async () => {
      try {
        const r = await approveAndScheduleSelectedAction([leadId]);
        const one = r.results?.find((x) => x.leadId === leadId);
        const scheduled = one && (one as { ok?: boolean }).ok !== false;
        if (scheduled) {
          setResult({ ok: true, msg: `Approved — scheduled for ${new Date(r.dateKey + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}` });
          onApproved?.();
        } else {
          setResult({ ok: false, msg: (one as { reason?: string })?.reason ?? "Could not schedule — package not eligible." });
        }
      } catch (e) {
        setResult({ ok: false, msg: (e as Error)?.message?.slice(0, 140) ?? "Approval failed." });
      }
    });
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={approve} disabled={pending || result?.ok} className="btn-primary text-sm disabled:opacity-50">
          {pending ? <><Loader2 size={14} className="animate-spin" /> Approving…</> : result?.ok ? <><Check size={14} /> Approved &amp; scheduled</> : "Approve & schedule"}
        </button>
        {result && !result.ok && <span className="flex items-center gap-1 text-[12.5px] text-coral-200"><AlertTriangle size={13} /> {result.msg}</span>}
        {result?.ok && <span className="text-[12.5px] text-teal-200">{result.msg}</span>}
      </div>
    </div>
  );
}

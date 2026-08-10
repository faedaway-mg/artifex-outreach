"use client";
// A one-tap operator recovery for an ACCIDENTAL terminal outcome (e.g. tapping
// "Permanently closed / invalid" instead of "Closed right now"). One lightweight
// confirmation guards against a stray tap; the reopen preserves all history/research.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Loader2 } from "lucide-react";
import { reopenLeadAction } from "@/lib/actions";

export function ResetLeadButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () =>
    start(async () => {
      setErr(null);
      const res = await reopenLeadAction(leadId);
      if (res.ok) router.refresh();
      else setErr(res.reason ?? "Couldn't reset the lead.");
    });

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="btn-secondary w-full justify-center !py-2.5 text-[14px]">
        <RotateCcw size={15} /> Reset lead — undo this outcome
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3">
      <p className="text-[13px] font-medium text-amber-200">Reset this lead?</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-chalk-400">
        This reopens the lead and makes it eligible for outreach again. Its history, research, and review are preserved.
      </p>
      {err && <p className="mt-1 text-[12px] text-coral-300">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={() => setConfirming(false)} disabled={pending} className="btn-ghost flex-1 justify-center !py-2 text-[13px] disabled:opacity-60">Cancel</button>
        <button onClick={reset} disabled={pending} className="btn-primary flex-1 justify-center !py-2 text-[13px] disabled:opacity-60">
          {pending ? <><Loader2 size={14} className="animate-spin" /> Resetting…</> : "Reset lead"}
        </button>
      </div>
    </div>
  );
}

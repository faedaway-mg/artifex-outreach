"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { setLaunchReviewConfirmed } from "@/lib/launch-actions";
import { cn } from "@/lib/utils";

export function ManualReviewToggle({ confirmed, confirmedAt }: { confirmed: boolean; confirmedAt?: string | null }) {
  const [isConfirmed, setConfirmed] = useState(confirmed);
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = !isConfirmed;
    setConfirmed(next);
    startTransition(async () => {
      await setLaunchReviewConfirmed(next);
    });
  };

  return (
    <div className={cn("card p-5", isConfirmed ? "border-teal-400/30" : "border-coral-400/30")}>
      <p className="text-sm font-semibold text-chalk-100">Final human checkpoint</p>
      <p className="mt-1 text-sm text-chalk-400">
        “Would I confidently send this to a real business owner today?” Live outreach stays blocked until you confirm.
      </p>
      <button
        onClick={toggle}
        disabled={pending}
        className={cn(
          "mt-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-60",
          isConfirmed
            ? "border-teal-400/40 bg-teal-400/10 text-teal-200 hover:bg-teal-400/15"
            : "border-white/[0.1] bg-white/[0.03] text-chalk-200 hover:bg-white/[0.06]",
        )}
      >
        {isConfirmed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
        {isConfirmed ? "Confirmed — I would send this today" : "Confirm launch readiness"}
      </button>
      {isConfirmed && confirmedAt && (
        <p className="mt-2 text-xs text-chalk-500">Signed off {new Date(confirmedAt).toLocaleString()}. Click again to revoke.</p>
      )}
    </div>
  );
}

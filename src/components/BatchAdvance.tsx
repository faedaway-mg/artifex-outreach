"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Batch advance — keep momentum. Marking a step done persists it (the task closes,
// the mission ticks up) and immediately advances to the next business. "Skip for now"
// moves on without completing. No dashboard in between; the loop just continues.
// ─────────────────────────────────────────────────────────────────────────────
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { completeTaskAction } from "@/lib/actions";

export function BatchAdvance({ taskId, nextHref, isLast, primaryDone = false }: { taskId: string | null; nextHref: string; isLast: boolean; primaryDone?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const done = () =>
    start(async () => {
      if (taskId) await completeTaskAction(taskId); // persist completion → mission progress
      router.push(nextHref);
    });

  const label = isLast ? "Done — finish" : "Done — next";

  // On a read-only step (no value-creating action above), advancing IS the decision — so
  // "Done — next" becomes the one gold action (ES-010: exactly one dominant action).
  if (primaryDone) {
    return (
      <div className="space-y-2">
        <button onClick={done} disabled={pending} className="btn-primary w-full justify-center !py-3 text-[15px] disabled:opacity-60">
          <Check size={17} /> {label} <ArrowRight size={15} />
        </button>
        <button onClick={() => router.push(nextHref)} disabled={pending} className="mx-auto block text-[13px] text-chalk-500 hover:text-chalk-300 disabled:opacity-50">
          Skip
        </button>
      </div>
    );
  }

  // Otherwise the value-creating action above is the hero — "Done" recedes and stays quiet
  // until the real work has been done.
  return (
    <div className="flex items-center justify-between">
      <button onClick={() => router.push(nextHref)} disabled={pending} className="text-[13px] text-chalk-500 hover:text-chalk-300 disabled:opacity-50">
        Skip
      </button>
      <button onClick={done} disabled={pending} className="btn-secondary !py-1.5 text-[12.5px] disabled:opacity-60">
        <Check size={14} /> {label} <ArrowRight size={13} />
      </button>
    </div>
  );
}

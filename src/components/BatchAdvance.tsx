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

export function BatchAdvance({ taskId, nextHref, isLast }: { taskId: string | null; nextHref: string; isLast: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const done = () =>
    start(async () => {
      if (taskId) await completeTaskAction(taskId); // persist completion → mission progress
      router.push(nextHref);
    });

  return (
    <div className="flex items-center justify-between">
      <button onClick={() => router.push(nextHref)} disabled={pending} className="text-[13px] text-chalk-500 hover:text-chalk-300 disabled:opacity-50">
        Skip for now
      </button>
      <button onClick={done} disabled={pending} className="btn-primary !py-2.5 text-[14px] disabled:opacity-60">
        <Check size={16} /> {isLast ? "Done — finish batch" : "Done — next business"} <ArrowRight size={15} />
      </button>
    </div>
  );
}

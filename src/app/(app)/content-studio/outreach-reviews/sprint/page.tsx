import Link from "next/link";
import { X } from "lucide-react";
import { SprintStart } from "@/components/outreach-review/SprintClient";
import { buildSprintBacklog } from "@/lib/outreach-review/sprint-backlog";
import { DEFAULT_BACKLOG, refillDecision } from "@/lib/outreach-review/eligibility";

export const dynamic = "force-dynamic";

// NARRATION SPRINT LANDING (mandate 28). Shows the ready-for-narration count + batch options. Read-only until
// the operator starts a sprint. Honest count: if production has fewer than the 100 target, it says so.
export default async function SprintLandingPage() {
  const b = await buildSprintBacklog({ nowMs: 1_760_000_000_000 });
  const refill = refillDecision(b.readyCount, DEFAULT_BACKLOG);
  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link href="/content-studio?type=proposal" data-sprint-back aria-label="Back to Outreach Reviews" className="rounded-lg border border-white/10 p-2 text-chalk-400 hover:text-chalk-100"><X size={16} /></Link>
        <div className="min-w-0 text-center">
          <div className="text-sm font-semibold text-chalk-50">Narration Sprint</div>
          <div className="text-[11px] text-chalk-500">Outreach Reviews</div>
        </div>
        <span className="w-8" />
      </div>
      <SprintStart readyCount={b.readyCount} />
      <p className="text-[11px] text-chalk-600">
        Target backlog: {DEFAULT_BACKLOG.target} · refill below {DEFAULT_BACKLOG.refillThreshold}.
        {refill.shouldRefill ? ` Currently ${b.readyCount} ready — ${refill.deficit} below target; discovery continues to refill (recipient resolution is the current gate).` : ` ${b.readyCount} ready.`}
      </p>
    </div>
  );
}

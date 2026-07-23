// ─────────────────────────────────────────────────────────────────────────────
// Today's Mission — one objective, not a dashboard.
//
// "Contact N businesses · ~T min · X of N done." A single line of intent above the
// work queue, with a progress bar that fills as batches complete. Nothing to analyze —
// just the target and how close you are to it.
// ─────────────────────────────────────────────────────────────────────────────
import { Target, CheckCircle2 } from "lucide-react";
import type { DailyMission as Mission } from "@/lib/work-queue";
import { minutesLabel } from "@/lib/work-queue";

export function DailyMission({ mission }: { mission: Mission }) {
  const { total, done, remaining, estMinutes } = mission;
  if (total === 0) return null;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = remaining === 0;

  return (
    <section className="card overflow-hidden p-5">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${complete ? "bg-emerald-400/12 text-emerald-300" : "bg-azure-400/10 text-azure-300"}`}>
          {complete ? <CheckCircle2 size={18} /> : <Target size={18} />}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Today's mission</p>
          <p className="text-[15px] font-semibold text-chalk-50">
            {complete ? "Mission complete — every business contacted." : `Contact ${total} ${total === 1 ? "business" : "businesses"}`}
          </p>
        </div>
        <div className="ml-auto shrink-0 text-right">
          <p className="text-[17px] font-semibold tabular-nums text-chalk-50">{done}<span className="text-chalk-500">/{total}</span></p>
          {!complete && estMinutes > 0 && <p className="text-[11px] text-chalk-500">~{minutesLabel(estMinutes)} left</p>}
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full transition-all ${complete ? "bg-emerald-400/70" : "bg-azure-400/70"}`} style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}

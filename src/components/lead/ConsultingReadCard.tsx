import { Target, HelpCircle, AlertTriangle } from "lucide-react";
import type { ConsultingRead } from "@/lib/outreach/consulting-read";

/**
 * The consulting read — judgment for the room, kept deliberately quiet. Three
 * things that matter, the objective, the biggest unknown, and the one risk.
 */
export function ConsultingReadCard({ read }: { read: ConsultingRead }) {
  return (
    <section className="card p-6">
      <p className="eyebrow text-azure-300">Three things that matter most</p>
      <ol className="mt-3 space-y-3">
        {read.threeThingsThatMatter.map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-azure-400/30 bg-azure-400/[0.06] text-[11px] font-medium text-azure-300">{i + 1}</span>
            <span className="text-[14px] leading-relaxed text-chalk-200">{t}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid gap-4 border-t border-white/[0.06] pt-5 sm:grid-cols-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500"><Target size={12} className="text-teal-300" /> Objective</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-chalk-300">{read.meetingObjective}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-chalk-500"><HelpCircle size={12} className="text-azure-300" /> Biggest unknown</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-chalk-300">{read.biggestUnknown}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-300/80"><AlertTriangle size={12} /> Watch for</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-chalk-300">{read.biggestRisk}</p>
        </div>
      </div>
    </section>
  );
}

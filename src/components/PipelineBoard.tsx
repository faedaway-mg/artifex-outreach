"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KanbanSquare, Table2 } from "lucide-react";
import { PIPELINE_STAGES, type Lead, type PipelineStage } from "@/lib/types";
import { changeStageAction } from "@/lib/actions";
import { TierBadge, ScorePill } from "@/components/ui";
import { formatRange, relativeDate, shortDate, STAGE_COLORS, cn } from "@/lib/utils";

export function PipelineBoard({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [view, setView] = useState<"board" | "table">("board");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);
  const [local, setLocal] = useState(leads);

  function drop(stage: PipelineStage) {
    if (!dragId) return;
    const lead = local.find((l) => l.id === dragId);
    setOverStage(null);
    setDragId(null);
    if (!lead || lead.pipelineStage === stage) return;
    setLocal((ls) => ls.map((l) => (l.id === dragId ? { ...l, pipelineStage: stage } : l)));
    start(async () => {
      await changeStageAction(lead.id, stage);
      router.refresh();
    });
  }

  const byStage = (stage: PipelineStage) => local.filter((l) => l.pipelineStage === stage);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex rounded-lg border border-white/10 p-0.5">
          <button onClick={() => setView("board")} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${view === "board" ? "bg-white/[0.08] text-chalk-100" : "text-chalk-500"}`}><KanbanSquare size={13} /> Board</button>
          <button onClick={() => setView("table")} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${view === "table" ? "bg-white/[0.08] text-chalk-100" : "text-chalk-500"}`}><Table2 size={13} /> Table</button>
        </div>
      </div>

      {view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {PIPELINE_STAGES.map((stage) => {
            const items = byStage(stage);
            return (
              <div
                key={stage}
                onDragOver={(e) => { e.preventDefault(); setOverStage(stage); }}
                onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                onDrop={() => drop(stage)}
                className={cn(
                  "flex w-64 shrink-0 flex-col rounded-2xl border p-2 transition-colors",
                  overStage === stage ? "border-azure-500/50 bg-azure-500/[0.04]" : "border-white/[0.05] bg-ink-900/40",
                )}
              >
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className={cn("text-xs font-medium", STAGE_COLORS[stage].split(" ")[0])}>{stage}</span>
                  <span className="text-xs text-chalk-600">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={() => setDragId(lead.id)}
                      className="card cursor-grab p-3 active:cursor-grabbing"
                    >
                      <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-chalk-100 hover:text-azure-300">
                        {lead.businessName}
                      </Link>
                      <p className="mt-0.5 text-[11px] text-chalk-500">{lead.industry}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <TierBadge tier={lead.tier} />
                        <ScorePill score={lead.leadScore} />
                      </div>
                      <div className="mt-2 space-y-0.5 text-[11px] text-chalk-500">
                        <p>Est: {formatRange(lead.estimatedValueLow, lead.estimatedValueHigh)}</p>
                        {lead.recommendedAction && <p className="text-amber-300/90">Next: {lead.recommendedAction}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/[0.06] text-left text-xs text-chalk-500">
              <tr>
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Next action</th>
                <th className="px-4 py-3 font-medium">Last contact</th>
                <th className="px-4 py-3 font-medium">Next follow-up</th>
                <th className="px-4 py-3 text-right font-medium">Est. value</th>
              </tr>
            </thead>
            <tbody>
              {local.map((lead) => (
                <tr key={lead.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <Link href={`/leads/${lead.id}`} className="font-medium text-chalk-100 hover:text-azure-300">{lead.businessName}</Link>
                    <p className="text-xs text-chalk-500">{lead.industry}</p>
                  </td>
                  <td className="px-4 py-3"><span className={cn("text-xs", STAGE_COLORS[lead.pipelineStage].split(" ")[0])}>{lead.pipelineStage}</span></td>
                  <td className="px-4 py-3 text-xs text-amber-300/90">{lead.recommendedAction ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-chalk-400">{relativeDate(lead.lastContactAt)}</td>
                  <td className="px-4 py-3 text-xs text-chalk-400">{shortDate(lead.nextFollowUpAt)}</td>
                  <td className="px-4 py-3 text-right text-xs text-chalk-300">{formatRange(lead.estimatedValueLow, lead.estimatedValueHigh)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

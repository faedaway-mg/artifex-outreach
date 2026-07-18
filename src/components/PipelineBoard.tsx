"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KanbanSquare, Table2 } from "lucide-react";
import type { Lead } from "@/lib/types";
import { changeStageAction } from "@/lib/actions";
import { JOURNEY_PHASES, JOURNEY_META, journeyPhaseOf, phaseToStage, ASIDE_STAGES, type JourneyPhase } from "@/lib/journey";
import { TierBadge } from "@/components/ui";
import { formatRange, cn } from "@/lib/utils";

// The pipeline reads as a business's PROGRESSION IN UNDERSTANDING & RELATIONSHIP,
// not a sales funnel. Columns are journey phases (a presentation of the underlying
// stages); dragging still writes the canonical stage via changeStageAction.
export function PipelineBoard({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [view, setView] = useState<"board" | "table">("board");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overPhase, setOverPhase] = useState<JourneyPhase | null>(null);
  const [local, setLocal] = useState(leads);

  function drop(phase: JourneyPhase) {
    setOverPhase(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const lead = local.find((l) => l.id === id);
    if (!lead) return;
    const stage = phaseToStage(phase);
    if (lead.pipelineStage === stage) return;
    setLocal((ls) => ls.map((l) => (l.id === id ? { ...l, pipelineStage: stage } : l)));
    start(async () => {
      await changeStageAction(lead.id, stage);
      router.refresh();
    });
  }

  const scoreOf = (l: Lead) => l.leadScore ?? 0;
  const inPhase = (phase: JourneyPhase) => local.filter((l) => journeyPhaseOf(l) === phase);
  const aside = local.filter((l) => journeyPhaseOf(l) == null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="flex rounded-lg border border-white/10 p-0.5">
          <button onClick={() => setView("board")} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${view === "board" ? "bg-white/[0.08] text-chalk-100" : "text-chalk-500"}`}><KanbanSquare size={13} /> Journey</button>
          <button onClick={() => setView("table")} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs ${view === "table" ? "bg-white/[0.08] text-chalk-100" : "text-chalk-500"}`}><Table2 size={13} /> Table</button>
        </div>
      </div>

      {view === "board" ? (
        <>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {JOURNEY_PHASES.map((phase) => {
              const items = inPhase(phase);
              const meta = JOURNEY_META[phase];
              return (
                <div
                  key={phase}
                  onDragOver={(e) => { e.preventDefault(); setOverPhase(phase); }}
                  onDragLeave={() => setOverPhase((s) => (s === phase ? null : s))}
                  onDrop={() => drop(phase)}
                  className={cn(
                    "flex w-64 shrink-0 flex-col rounded-2xl border p-2 transition-colors",
                    overPhase === phase ? "border-azure-500/50 bg-azure-500/[0.04]" : "border-white/[0.05] bg-ink-900/40",
                  )}
                >
                  <div className="px-2 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className={cn("flex items-center gap-1.5 text-xs font-medium", meta.tone.split(" ")[0])}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {phase}
                      </span>
                      <span className="text-xs text-chalk-600">{items.length}</span>
                    </div>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-chalk-600">{meta.motion}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map((lead) => (
                      <div key={lead.id} draggable onDragStart={() => setDragId(lead.id)} className="card cursor-grab p-3 active:cursor-grabbing">
                        <Link href={`/leads/${lead.id}`} className="text-sm font-medium text-chalk-100 hover:text-azure-300">{lead.businessName}</Link>
                        <p className="mt-0.5 text-[11px] text-chalk-500">{lead.industry}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <TierBadge tier={lead.tier} />
                          <span className="inline-flex items-baseline gap-0.5 font-mono text-xs text-teal-300/90">{scoreOf(lead)}<span className="text-chalk-600">/100</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {aside.length > 0 && (
            <details className="rounded-2xl border border-white/[0.05] bg-ink-900/30 p-3">
              <summary className="cursor-pointer text-xs text-chalk-500">Not currently proceeding · {aside.length} ({ASIDE_STAGES.join(", ")})</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {aside.map((l) => (
                  <Link key={l.id} href={`/leads/${l.id}`} className="rounded-lg border border-white/[0.06] px-3 py-1.5 text-xs text-chalk-400 hover:text-chalk-100">
                    {l.businessName} <span className="text-chalk-600">· {l.pipelineStage}</span>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/[0.06] text-left text-xs text-chalk-500">
              <tr>
                <th className="px-4 py-3 font-medium">Business</th>
                <th className="px-4 py-3 font-medium">Journey phase</th>
                <th className="px-4 py-3 font-medium">Motion</th>
                <th className="px-4 py-3 text-right font-medium">Opportunity</th>
                <th className="px-4 py-3 text-right font-medium">Relationship value</th>
              </tr>
            </thead>
            <tbody>
              {local.map((lead) => {
                const phase = journeyPhaseOf(lead);
                const meta = phase ? JOURNEY_META[phase] : null;
                return (
                  <tr key={lead.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="font-medium text-chalk-100 hover:text-azure-300">{lead.businessName}</Link>
                      <p className="text-xs text-chalk-500">{lead.industry}</p>
                    </td>
                    <td className="px-4 py-3"><span className={cn("text-xs", meta ? meta.tone.split(" ")[0] : "text-chalk-500")}>{phase ?? "Not proceeding"}</span></td>
                    <td className="px-4 py-3 text-xs text-chalk-500">{meta?.motion ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-teal-300/90">{scoreOf(lead)}/100</td>
                    <td className="px-4 py-3 text-right text-xs text-chalk-400">{formatRange(lead.estimatedValueLow, lead.estimatedValueHigh)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

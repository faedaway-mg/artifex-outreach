"use client";
import { useState, useTransition } from "react";
import { Scale, ArrowRight } from "lucide-react";
import { previewRebalanceAction, applyRebalanceAction } from "@/lib/operators/actions";

type Move = { leadId: string; businessName: string; from: string | null; to: string; reason: string; because: string[] };

/**
 * A deliberate rebalance: preview, then apply.
 *
 * The preview is the real scheduler with its writes withheld, so what is on
 * screen is exactly what will happen. Moving half a book of business is not
 * something the system should decide overnight on its own — so it doesn't.
 */
export function RebalancePanel({ enabled }: { enabled: boolean }) {
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [applied, setApplied] = useState<number | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-200">
        <Scale size={15} className="text-azure-300" /> Rebalance the workspace
      </h2>
      <p className="mt-0.5 text-[11px] text-chalk-500">
        Spreads quiet businesses off whoever is carrying the most until the split is even. Live conversations stay where they are.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          className="btn-secondary !px-3 !py-1.5 text-xs"
          onClick={() =>
            start(async () => {
              setApplied(null);
              const result = await previewRebalanceAction();
              setMoves(result.reassignments);
            })
          }
        >
          Preview
        </button>
        {moves && moves.length > 0 && enabled && (
          <button
            type="button"
            disabled={pending}
            className="btn-primary !px-3 !py-1.5 text-xs"
            onClick={() =>
              start(async () => {
                const result = await applyRebalanceAction();
                setApplied(result.written.length);
                setMoves(null);
              })
            }
          >
            Apply {moves.length} {moves.length === 1 ? "change" : "changes"}
          </button>
        )}
      </div>

      {!enabled && (
        <p className="mt-3 text-[11px] text-amber-300/80">
          Preview only. Automatic distribution is off, so nothing here can change ownership yet.
        </p>
      )}

      {applied != null && (
        <p className="mt-3 text-sm text-emerald-300">
          {applied === 0 ? "Nothing needed to move." : `${applied} ${applied === 1 ? "business" : "businesses"} reassigned. Every change is in the timeline.`}
        </p>
      )}

      {moves && moves.length === 0 && (
        <p className="mt-3 text-sm text-chalk-400">The workspace is already balanced.</p>
      )}

      {moves && moves.length > 0 && (
        <ul className="mt-3 space-y-2">
          {moves.map((m) => (
            <li key={m.leadId} className="rounded-lg bg-white/[0.03] p-3">
              <p className="flex items-center gap-2 text-sm text-chalk-100">
                {m.businessName} <ArrowRight size={13} className="text-chalk-600" /> <span className="text-azure-200">{m.to}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-chalk-500">{m.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

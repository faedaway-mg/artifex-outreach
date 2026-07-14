"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { overrideScoreAction } from "@/lib/actions";
import { SCORE_LABELS, SCORE_MAX, TIERS, type Lead, type ScoreBreakdown } from "@/lib/types";

export function ScorePanel({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const b = lead.scoreBreakdown;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-chalk-100">Lead score</h2>
        <button onClick={() => setEditing((e) => !e)} className="btn-ghost !px-2 !py-1 text-xs">
          <SlidersHorizontal size={13} /> Override
        </button>
      </div>

      {b == null ? (
        <p className="text-sm text-chalk-500">Not yet scored. Run qualification to compute a transparent breakdown.</p>
      ) : (
        <>
          <div className="mb-4 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold text-amber-300">{lead.leadScore}</span>
            <span className="text-sm text-chalk-500">/ 100 · Tier {lead.tier}</span>
          </div>
          <div className="space-y-2.5">
            {(Object.keys(SCORE_MAX) as (keyof ScoreBreakdown)[]).map((k) => {
              const val = b[k];
              const max = SCORE_MAX[k];
              return (
                <div key={k}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-chalk-400">{SCORE_LABELS[k]}</span>
                    <span className="font-mono text-chalk-300">{val}/{max}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-gradient-to-r from-azure-500 to-indigo-500" style={{ width: `${(val / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {editing && (
        <form
          action={overrideScoreAction.bind(null, lead.id)}
          onSubmit={() => setTimeout(() => { setEditing(false); router.refresh(); }, 300)}
          className="mt-4 space-y-2 border-t border-white/[0.06] pt-4"
        >
          <label className="block">
            <span className="field-label">Total score (0–100)</span>
            <input name="leadScore" type="number" min={0} max={100} defaultValue={lead.leadScore ?? 0} className="input" />
          </label>
          <label className="block">
            <span className="field-label">Tier</span>
            <select name="tier" defaultValue={lead.tier ?? "B"} className="input">
              {TIERS.map((t) => <option key={t} value={t}>Tier {t}</option>)}
            </select>
          </label>
          <button type="submit" className="btn-primary w-full text-xs">Save override</button>
        </form>
      )}
    </div>
  );
}

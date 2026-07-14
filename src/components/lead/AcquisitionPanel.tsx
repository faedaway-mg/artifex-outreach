"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Target, Ban, ClipboardList, ArrowUpRight } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { assignStrategyAction, overrideStrategyAction, prepareAcquisitionPlanAction, markDoNotContactAction } from "@/lib/acquisition-actions";
import { ACQUISITION_STRATEGIES, type Lead, type AcquisitionPlan, type AcquisitionStrategy, type AcquisitionScoreBreakdown } from "@/lib/types";

const LABELS: Record<keyof AcquisitionScoreBreakdown, string> = {
  opportunityValue: "Opportunity value", need: "Modernization need", contactability: "Contactability",
  trustStability: "Trust & stability", personalization: "Personalization", costToPursue: "Ease to pursue",
};
const MAX: Record<keyof AcquisitionScoreBreakdown, number> = { opportunityValue: 25, need: 20, contactability: 20, trustStability: 15, personalization: 10, costToPursue: 10 };
const STRAT_STYLE: Record<string, string> = {
  Personal: "text-amber-300", Assisted: "text-indigo-300", Light: "text-azure-300", Nurture: "text-teal-300",
  "Manual Review": "text-chalk-300", "Do Not Contact": "text-coral-300",
};

export function AcquisitionPanel({ lead, plans }: { lead: Lead; plans: AcquisitionPlan[] }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [override, setOverride] = useState<AcquisitionStrategy | "">("");
  const b = lead.acquisitionScoreBreakdown;
  const activePlan = plans.filter((p) => p.status !== "stopped").sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100"><Target size={16} className="text-amber-300" /> Acquisition strategy</h2>
        {lead.acquisitionStrategy && <span className={`text-sm font-semibold ${STRAT_STYLE[lead.acquisitionStrategy]}`}>{lead.acquisitionStrategy}{lead.acquisitionOverride ? " (override)" : ""}</span>}
      </div>

      {!lead.acquisitionStrategy ? (
        <div className="space-y-2">
          <p className="text-sm text-chalk-500">No acquisition treatment assigned yet. Rating is only one small signal — the engine weighs value, need, contactability, trust, personalization, and cost.</p>
          <ActionButton variant="primary" className="text-xs" onRun={() => assignStrategyAction(lead.id).then(refresh)}><Target size={13} /> Assign acquisition strategy</ActionButton>
        </div>
      ) : (
        <div className="space-y-4">
          {lead.acquisitionReason && <p className="text-sm text-chalk-300">{lead.acquisitionReason}</p>}
          {b && (
            <div className="space-y-2">
              {(Object.keys(MAX) as (keyof AcquisitionScoreBreakdown)[]).map((k) => (
                <div key={k}>
                  <div className="flex justify-between text-[11px]"><span className="text-chalk-400">{LABELS[k]}</span><span className="font-mono text-chalk-500">{b[k]}/{MAX[k]}</span></div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-indigo-500" style={{ width: `${(b[k] / MAX[k]) * 100}%` }} /></div>
                </div>
              ))}
              <p className="text-[11px] text-chalk-600">Total {lead.acquisitionScore}/100</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton variant="ghost" className="text-xs" onRun={() => assignStrategyAction(lead.id).then(refresh)}>Re-evaluate</ActionButton>
            <select value={override} onChange={(e) => setOverride(e.target.value as AcquisitionStrategy)} className="input !w-auto !py-1.5 text-xs">
              <option value="">Override…</option>
              {ACQUISITION_STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {override && <ActionButton variant="secondary" className="text-xs" onRun={() => overrideStrategyAction(lead.id, override as AcquisitionStrategy, "Jordan's judgment").then(() => { setOverride(""); refresh(); })}>Apply override</ActionButton>}
            <ActionButton variant="danger" className="text-xs" confirm="Mark Do Not Contact and suppress?" onRun={() => markDoNotContactAction(lead.id).then(refresh)}><Ban size={13} /> Do Not Contact</ActionButton>
          </div>

          {/* Plan */}
          <div className="border-t border-white/[0.06] pt-3">
            {!activePlan ? (
              ["Manual Review", "Do Not Contact"].includes(lead.acquisitionStrategy) ? (
                <p className="text-xs text-chalk-500">No sending plan for this treatment.</p>
              ) : (
                <ActionButton variant="primary" className="text-xs" onRun={() => prepareAcquisitionPlanAction(lead.id).then(refresh)}><ClipboardList size={13} /> Prepare acquisition plan</ActionButton>
              )
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-chalk-400">
                  Plan: <span className="text-chalk-200">{activePlan.assetPackage}</span> · {activePlan.approvalStatus} · {activePlan.maxTouches} touches · ${activePlan.estimatedCost.toFixed(2)}
                  {activePlan.stopReason ? <span className="text-coral-300"> · stopped: {activePlan.stopReason}</span> : ""}
                </div>
                {activePlan.approvalStatus === "pending" && <Link href="/approvals" className="btn-secondary !px-2 !py-1 text-xs"><ArrowUpRight size={12} /> Review in Approval Center</Link>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

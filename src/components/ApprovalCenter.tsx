"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pause, X, ShieldAlert, Mail, Phone } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { approvePlanAction, holdPlanAction, rejectPlanAction, approveBatchAction } from "@/lib/acquisition-actions";
import { EmptyState } from "@/components/ui";

export interface ApprovalItem {
  planId: string; leadId: string; businessName: string; strategy: string; estValue: string; reason: string;
  contactEmail: string | null; channel: string; firstSubject: string; firstBody: string; steps: number;
  cost: number; compliance: { ok: boolean; blockers: string[] }; suppressed: boolean; canBatch: boolean;
}

const STRAT_STYLE: Record<string, string> = {
  Personal: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  Assisted: "border-indigo-400/40 bg-indigo-400/10 text-indigo-300",
  Light: "border-azure-500/30 bg-azure-500/10 text-azure-300",
  Nurture: "border-teal-400/30 bg-teal-400/10 text-teal-300",
};

export function ApprovalCenter({ items, batchMax }: { items: ApprovalItem[]; batchMax: number }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const batchEligible = items.filter((i) => i.canBatch && i.compliance.ok);
  const selectedIds = Object.keys(selected).filter((k) => selected[k]);

  if (items.length === 0) return <EmptyState icon={ShieldAlert} title="No plans awaiting approval." hint="Prepare an acquisition plan from a lead to queue it here. Nothing sends without your approval." />;

  return (
    <div className="space-y-4">
      {batchEligible.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
          <p className="text-xs text-chalk-400">Assisted/Light batch approval — up to {batchMax} at once. Personal leads are always individual.</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(Object.fromEntries(batchEligible.slice(0, batchMax).map((i) => [i.planId, true])))} className="btn-ghost text-xs">Select {Math.min(batchMax, batchEligible.length)}</button>
            <ActionButton variant="primary" className="text-xs" disabled={selectedIds.length === 0} onRun={() => approveBatchAction(selectedIds).then(() => { setSelected({}); refresh(); })}>
              <Check size={13} /> Approve {selectedIds.length || ""} selected
            </ActionButton>
          </div>
        </div>
      )}

      {items.map((it) => (
        <div key={it.planId} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {it.canBatch && it.compliance.ok && <input type="checkbox" checked={!!selected[it.planId]} onChange={(e) => setSelected((s) => ({ ...s, [it.planId]: e.target.checked }))} className="accent-azure-500" />}
                <Link href={`/leads/${it.leadId}`} className="font-semibold text-chalk-50 hover:text-azure-300">{it.businessName}</Link>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${STRAT_STYLE[it.strategy] ?? "border-white/10 text-chalk-400"}`}>{it.strategy}</span>
                <span className="text-xs text-chalk-500">Est. {it.estValue} · {it.steps} touches · ${it.cost.toFixed(2)}</span>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm text-chalk-300">{it.reason}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-chalk-500">
                <span className="inline-flex items-center gap-1"><Mail size={12} /> {it.contactEmail ?? "no email"}</span>
                <span className="inline-flex items-center gap-1"><Phone size={12} /> {it.channel}</span>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-chalk-400">First message</summary>
                <div className="mt-1 rounded-lg border border-white/[0.06] p-2.5">
                  <p className="text-xs font-medium text-chalk-200">{it.firstSubject}</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-chalk-400">{it.firstBody}</pre>
                </div>
              </details>
              {!it.compliance.ok && (
                <div className="mt-2 rounded-lg border border-coral-500/30 bg-coral-500/[0.05] p-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-coral-200"><ShieldAlert size={13} /> Blocked — cannot approve:</p>
                  {it.compliance.blockers.map((b, i) => <p key={i} className="text-[11px] text-coral-300/90">• {b}</p>)}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <ActionButton variant="primary" className="text-xs" disabled={!it.compliance.ok} onRun={() => approvePlanAction(it.planId).then(refresh)}><Check size={13} /> Approve</ActionButton>
              <div className="flex gap-2">
                <ActionButton variant="secondary" className="!px-2 !py-1 text-[11px]" onRun={() => holdPlanAction(it.planId).then(refresh)}><Pause size={12} /> Hold</ActionButton>
                <ActionButton variant="danger" className="!px-2 !py-1 text-[11px]" onRun={() => rejectPlanAction(it.planId).then(refresh)}><X size={12} /> Reject</ActionButton>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

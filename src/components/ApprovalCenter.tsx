"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pause, X, ShieldAlert, Mail, Radio, AlertTriangle, Package, Gauge } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { approvePlanAction, holdPlanAction, rejectPlanAction, approveBatchAction } from "@/lib/acquisition-actions";
import { EmptyState } from "@/components/ui";

export interface ApprovalItem {
  planId: string; leadId: string; businessName: string; strategy: string; estValue: string;
  opportunitySummary: string; websiteHealth: string; highlights: string[]; contactConfidence: { level: string; label: string };
  reason: string; contactEmail: string | null; channel: string; cost: number; assetPackage: string; assetReady: boolean; assetMissing: string[];
  sequence: { stepNumber: number; delayDays: number; subject: string; body: string }[];
  compliance: { ok: boolean; blockers: string[]; warnings: string[] }; riskFlags: string[]; suppressed: boolean; canBatch: boolean;
}

const STRAT_STYLE: Record<string, string> = {
  Personal: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  Assisted: "border-indigo-400/40 bg-indigo-400/10 text-indigo-300",
  Light: "border-azure-500/30 bg-azure-500/10 text-azure-300",
  Nurture: "border-teal-400/30 bg-teal-400/10 text-teal-300",
};
const CONF_STYLE: Record<string, string> = { high: "text-teal-300", medium: "text-amber-300", low: "text-coral-300" };

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
          <p className="text-xs text-chalk-400">Assisted/Light batch — up to {batchMax}. Personal is always individual.</p>
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
          {/* Header row */}
          <div className="flex flex-wrap items-center gap-2">
            {it.canBatch && it.compliance.ok && <input type="checkbox" checked={!!selected[it.planId]} onChange={(e) => setSelected((s) => ({ ...s, [it.planId]: e.target.checked }))} className="accent-azure-500" />}
            <Link href={`/leads/${it.leadId}`} className="text-[15px] font-semibold text-chalk-50 hover:text-azure-300">{it.businessName}</Link>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${STRAT_STYLE[it.strategy] ?? "border-white/10 text-chalk-400"}`}>{it.strategy}</span>
            <span className="text-xs text-chalk-400">{it.estValue}</span>
            <span className="ml-auto flex items-center gap-1 text-xs text-chalk-500"><Gauge size={12} /> ${it.cost.toFixed(2)} · {it.channel}</span>
          </div>

          {/* Decision grid */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-chalk-600">Opportunity</p>
              <p className="text-sm text-chalk-300">{it.opportunitySummary}</p>
              {it.highlights.length > 0 && <ul className="mt-1 space-y-0.5">{it.highlights.map((h, i) => <li key={i} className="text-xs text-chalk-400">• {h}</li>)}</ul>}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-chalk-400"><span className="text-chalk-600">Website:</span> {it.websiteHealth}</p>
              <p className="text-xs"><span className="text-chalk-600">Contact:</span> <span className={CONF_STYLE[it.contactConfidence.level]}>{it.contactConfidence.level}</span> <span className="text-chalk-500">· {it.contactConfidence.label}</span></p>
              <p className="flex items-center gap-1.5 text-xs"><Package size={12} className="text-chalk-500" /><span className="text-chalk-600">Assets ({it.assetPackage}):</span> {it.assetReady ? <span className="text-teal-300">ready</span> : <span className="text-amber-300">missing {it.assetMissing.join(", ")}</span>}</p>
              <p className="text-xs text-chalk-500">{it.reason}</p>
            </div>
          </div>

          {/* Sequence preview */}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-chalk-400">Sequence preview ({it.sequence.length} steps)</summary>
            <div className="mt-1 space-y-1.5">
              {it.sequence.map((s) => (
                <div key={s.stepNumber} className="rounded-lg border border-white/[0.06] p-2">
                  <p className="text-[11px] text-chalk-500">Day {s.delayDays} · {s.subject}</p>
                  <pre className="mt-1 line-clamp-3 whitespace-pre-wrap font-sans text-[11px] text-chalk-400">{s.body}</pre>
                </div>
              ))}
            </div>
          </details>

          {/* Risk + compliance */}
          {(it.riskFlags.length > 0 || !it.compliance.ok) && (
            <div className="mt-3 space-y-1">
              {it.riskFlags.map((r, i) => <p key={i} className="flex items-center gap-1.5 text-[11px] text-amber-300/90"><AlertTriangle size={11} /> {r}</p>)}
              {!it.compliance.ok && it.compliance.blockers.map((b, i) => <p key={i} className="flex items-center gap-1.5 text-[11px] text-coral-300"><ShieldAlert size={11} /> Blocked: {b}</p>)}
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex items-center gap-2 border-t border-white/[0.06] pt-3">
            <ActionButton variant="primary" className="text-xs" disabled={!it.compliance.ok} onRun={() => approvePlanAction(it.planId).then(refresh)}><Check size={14} /> Approve</ActionButton>
            <ActionButton variant="secondary" className="!px-2 !py-1 text-xs" onRun={() => holdPlanAction(it.planId).then(refresh)}><Pause size={12} /> Hold</ActionButton>
            <ActionButton variant="danger" className="!px-2 !py-1 text-xs" onRun={() => rejectPlanAction(it.planId).then(refresh)}><X size={12} /> Reject</ActionButton>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-chalk-600"><Mail size={11} /> {it.contactEmail ?? "no email"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

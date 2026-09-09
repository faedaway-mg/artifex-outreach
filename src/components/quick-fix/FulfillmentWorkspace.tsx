"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, ShieldAlert, KeyRound, Lock, ListChecks, Rocket, CheckCircle2, AlertTriangle,
  CircleHelp, ArrowRight, Wrench,
} from "lucide-react";
import type { FulfillmentPacket } from "@/lib/quick-fix/fulfillment-center";

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;
const KIND_TONE: Record<string, string> = {
  prepare: "text-azure-300", implement: "text-chalk-200", verify: "text-teal-300",
  deploy: "text-amber-300", retest: "text-teal-300", evidence: "text-indigo-300",
};

function Section({ icon: Icon, title, accent = "text-chalk-400", children }: { icon: any; title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className={`flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide ${accent}`}><Icon size={14} /> {title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Check({ label, tone = "text-chalk-200" }: { label: string; tone?: string }) {
  const [done, setDone] = useState(false);
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-[13.5px]">
      <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="mt-0.5 h-4 w-4 accent-teal-400" />
      <span className={done ? "text-chalk-500 line-through" : tone}>{label}</span>
    </label>
  );
}

export function FulfillmentWorkspace({ packet }: { packet: FulfillmentPacket }) {
  const router = useRouter();
  const [state, setState] = useState(packet.jobState);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exception, setException] = useState("");

  async function advance(to: string, note?: string) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/quick-fix/fulfillment/${packet.offerId}/advance`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, note }),
      });
      const j = await r.json();
      if (j.ok) { setState(j.state); router.refresh(); } else setErr(j.error || "Could not advance the job.");
    } catch { setErr("Network error advancing the job."); }
    setBusy(false);
  }

  const rb = packet.runbook;
  const nexts: Array<{ to: string; label: string }> = [
    { to: "IN_PROGRESS", label: "Start fix" },
    { to: "QA", label: "Move to QA" },
    { to: "DELIVERED", label: "Mark delivered" },
    { to: "COMPLETE", label: "Complete" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300"><Wrench size={12} /> Fulfillment · {packet.platform === "unknown" ? "platform unknown" : packet.accessCenter.platformLabel}</p>
            <h1 className="mt-1 truncate text-xl font-semibold text-chalk-50">{packet.serviceName}</h1>
            <p className="text-[13px] text-chalk-400">{packet.company} · {usd(packet.priceCents)} · {packet.turnaround}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-[12px] font-medium text-chalk-200">{state}</span>
        </div>
        {err && <p className="mt-3 rounded-lg bg-coral-500/10 px-3 py-2 text-[12.5px] text-coral-300">{err}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {nexts.map((n) => (
            <button key={n.to} disabled={busy || state === n.to} onClick={() => advance(n.to)} className="btn-secondary !px-3 !py-1.5 text-[12.5px] disabled:opacity-40">{n.label}</button>
          ))}
        </div>
      </div>

      {/* 1 · CUSTOMER & SCOPE */}
      <Section icon={Building2} title="Customer & scope" accent="text-chalk-300">
        <p className="text-[13.5px] text-chalk-200"><span className="text-chalk-500">Observed issue:</span> {packet.finding}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-chalk-500">
          <span>SKU <span className="text-chalk-300">{packet.sku ?? "—"}</span></span>
          <span>Evidence <span className="text-chalk-300">{packet.evidenceGrade}</span></span>
          <span>Confidence <span className="text-chalk-300">{packet.confidence.toFixed(2)}</span></span>
          <span>Revisions <span className="text-chalk-300">{packet.revisionPolicy}</span></span>
          {packet.termsVersion && <span>Terms <span className="text-chalk-300">{packet.termsVersion}</span></span>}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase text-teal-300">In scope</p>
            <ul className="mt-1 space-y-1 text-[13px] text-chalk-200">{packet.includedItems.map((x, i) => <li key={i} className="flex gap-1.5"><CheckCircle2 size={14} className="mt-0.5 flex-none text-teal-300" />{x}</li>)}</ul>
          </div>
          <div className="rounded-xl border border-coral-500/25 bg-coral-500/[0.06] p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-coral-300"><ShieldAlert size={13} /> Do not touch</p>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-chalk-300">{packet.doNotTouch.slice(0, 8).map((x, i) => <li key={i}>· {x}</li>)}</ul>
          </div>
        </div>
      </Section>

      {/* 2 · ACCESS CENTER */}
      <Section icon={KeyRound} title="Access center · least privilege" accent="text-azure-300">
        <div className="flex items-center gap-2 rounded-lg border border-teal-400/20 bg-teal-400/[0.06] px-3 py-2 text-[12.5px] text-teal-200">
          <Lock size={14} className="flex-none" /> We never ask for a password. Access is via {packet.accessCenter.platformLabel} native invite — the minimum this fix needs.
        </div>
        {packet.accessCenter.instructions.length === 0 ? (
          <p className="mt-3 text-[13px] text-chalk-400">No external access required for this fix.</p>
        ) : packet.accessCenter.instructions.map((a) => (
          <div key={a.key} className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[13px] font-medium text-chalk-100">{a.label} <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-chalk-400">{a.method}</span></p>
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[12.5px] text-chalk-300">{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        ))}
        <p className="mt-3 text-[11.5px] text-chalk-600">Never request: {packet.accessCenter.neverAskFor.join(" · ")}.</p>
        <div className="mt-2 flex items-center gap-2 text-[12px] text-chalk-400"><CircleHelp size={13} className="text-azure-300" /> {packet.accessCenter.assist.note}</div>
        <p className="mt-2 text-[12px] text-chalk-500"><span className="text-chalk-400">At delivery:</span> {packet.accessCloseout}</p>
      </Section>

      {/* 3 · EXECUTION RUNBOOK */}
      <Section icon={ListChecks} title="Execution runbook" accent="text-chalk-300">
        {!rb.supported ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-[13px] text-amber-200">
            <AlertTriangle size={15} className="mt-0.5 flex-none" /> NEEDS TECHNICAL REVIEW — {rb.reviewReason} Confirm the platform and correct method before making changes.
          </div>
        ) : (
          <div className="space-y-0.5">
            {rb.steps.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className={`w-16 shrink-0 text-[10px] font-semibold uppercase ${KIND_TONE[s.kind] ?? "text-chalk-500"}`}>{s.kind}</span>
                <Check label={s.label} />
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[12px] text-chalk-500"><span className="text-chalk-400">Rollback:</span> {rb.rollback}</p>
      </Section>

      {/* 4 · QA & DEPLOYMENT */}
      <Section icon={Rocket} title="QA & deployment" accent="text-amber-300">
        <p className="text-[11px] font-semibold uppercase text-chalk-500">QA — required before deploy</p>
        <div className="mt-1">{rb.qaChecklist.map((q, i) => <Check key={i} label={q} />)}</div>
        <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-200"><Rocket size={13} /> Deploy</p>
          <p className="mt-1 text-[13px] text-chalk-200">{rb.deployMethod}</p>
          <p className="mt-1.5 text-[12px] text-teal-300">Then retest the LIVE production URL — desktop + mobile — before Delivered.</p>
        </div>
      </Section>

      {/* 5 · COMPLETION EVIDENCE */}
      <Section icon={CheckCircle2} title="Completion evidence" accent="text-indigo-300">
        <p className="text-[12.5px] text-chalk-400">Capture actual proof (no fabricated results) before completing:</p>
        <div className="mt-1">{packet.completionEvidenceRequired.map((e, i) => <Check key={i} label={e} tone="text-chalk-200" />)}</div>
      </Section>

      {/* Scope exception / refund path */}
      <Section icon={AlertTriangle} title="Scope exception / cancel" accent="text-coral-300">
        <p className="text-[12.5px] text-chalk-400">If the actual issue differs materially from the purchased scope, or access can't be obtained, don't silently absorb it — record the exception and choose a route. Refund/cancel is a deliberate, audited action.</p>
        <textarea value={exception} onChange={(e) => setException(e.target.value)} placeholder="What did you actually observe? (recorded on the audit trail)" className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-chalk-100 outline-none focus:border-coral-400/50" rows={2} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={busy} onClick={() => advance("CANCELED", exception || "scope exception")} className="btn-secondary !px-3 !py-1.5 text-[12.5px]">Cancel job</button>
          <button disabled={busy} onClick={() => advance("REFUNDED", exception || "refund agreed")} className="btn-danger !px-3 !py-1.5 text-[12.5px]">Mark refunded</button>
          <span className="self-center text-[11.5px] text-chalk-600">Stripe refunds are issued in the Stripe Dashboard; this records the outcome + audit.</span>
        </div>
      </Section>
    </div>
  );
}

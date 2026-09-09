"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, ShieldAlert, KeyRound, Lock, ListChecks, Rocket, CheckCircle2, AlertTriangle,
  CircleHelp, ArrowRight, Wrench, Send,
} from "lucide-react";
import type { FulfillmentPacket } from "@/lib/quick-fix/fulfillment-center";

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;
const KIND_TONE: Record<string, string> = {
  prepare: "text-azure-300", implement: "text-chalk-200", verify: "text-teal-300",
  deploy: "text-amber-300", retest: "text-teal-300", evidence: "text-indigo-300",
};

// ── Persisted sub-state passed from the server (Part A) ──────────────────────────
export interface WorkspacePersisted {
  platform: string;
  runbookState: { playbookId: string; steps: Record<string, { done: boolean }> } | null;
  qaState: Record<string, { done: boolean }>;
  accessState: Record<string, { status: string; method?: string }>;
  evidence: Array<{ id: string; kind: string; label: string; demonstrates: string; url?: string | null; storageKey?: string | null }>;
  gate: { ok: boolean; blockers: string[] };
}

function Section({ icon: Icon, title, accent = "text-chalk-400", children }: { icon: any; title: string; accent?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className={`flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide ${accent}`}><Icon size={14} /> {title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// A checkbox whose state is PERSISTED via a POST — hydrates from `initial` so a reload
// or a day-later resumes exactly. Optimistic; reverts on server error.
function PersistedCheck({ label, initial, onToggle, tone = "text-chalk-200" }: { label: string; initial: boolean; onToggle: (next: boolean) => Promise<boolean>; tone?: string }) {
  const [done, setDone] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5 text-[13.5px]">
      <input
        type="checkbox" checked={done} disabled={busy}
        onChange={async (e) => {
          const next = e.target.checked;
          setBusy(true); setDone(next);
          const ok = await onToggle(next);
          if (!ok) setDone(!next);
          setBusy(false);
        }}
        className="mt-0.5 h-4 w-4 accent-teal-400"
      />
      <span className={done ? "text-chalk-500 line-through" : tone}>{label}</span>
    </label>
  );
}

export function FulfillmentWorkspace({ packet, persisted }: { packet: FulfillmentPacket; persisted: WorkspacePersisted }) {
  const router = useRouter();
  const [state, setState] = useState(packet.jobState);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [exception, setException] = useState("");
  const rb = packet.runbook;
  const playbookId = persisted.runbookState?.playbookId ?? `pb-${packet.sku ?? "unknown"}-v1`;

  async function post(path: string, body: any): Promise<boolean> {
    try {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) { setErr(j.error || "Could not save."); return false; }
      setErr(null); router.refresh(); return true;
    } catch { setErr("Network error."); return false; }
  }

  const setRunbookStep = (stepId: string, done: boolean) => post(`/api/quick-fix/fulfillment/${packet.offerId}/runbook-step`, { stepId, done, playbookId });
  const setQaItem = (itemId: string, done: boolean) => post(`/api/quick-fix/fulfillment/${packet.offerId}/qa-item`, { itemId, done });
  const setAccessItem = (key: string, status: string, method?: string) => post(`/api/quick-fix/fulfillment/${packet.offerId}/access-item`, { key, status, method });

  async function advance(to: string, note?: string) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/quick-fix/fulfillment/${packet.offerId}/advance`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, note }),
      });
      const j = await r.json();
      if (j.ok) { setState(j.state); router.refresh(); }
      else setErr((j.error || "Could not advance the job.") + (j.blockers?.length ? " — " + j.blockers.join("; ") : ""));
    } catch { setErr("Network error advancing the job."); }
    setBusy(false);
  }

  async function sendCompletion() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/quick-fix/fulfillment/${packet.offerId}/send-completion`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) setErr(j.error || "Could not prepare the completion email.");
      else setErr(j.sent ? "Completion email sent to the internal test recipient." : "Completion email PREPARED (not sent — sending is disabled in this environment).");
    } catch { setErr("Network error preparing the completion email."); }
    setBusy(false);
  }

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
        {!persisted.gate.ok && (
          <p className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200">
            Delivery gate: {persisted.gate.blockers.join(" · ")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {nexts.map((n) => (
            <button key={n.to} disabled={busy || state === n.to} onClick={() => advance(n.to)} className="btn-secondary !px-3 !py-1.5 text-[12.5px] disabled:opacity-40">{n.label}</button>
          ))}
          <button disabled={busy} onClick={sendCompletion} className="btn-secondary !px-3 !py-1.5 text-[12.5px] disabled:opacity-40"><Send size={12} className="mr-1 inline" /> Send completion (preview)</button>
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
        ) : packet.accessCenter.instructions.map((a) => {
          const st = persisted.accessState[a.key]?.status ?? "REQUESTED";
          return (
            <div key={a.key} className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-chalk-100">{a.label} <span className="ml-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-chalk-400">{a.method}</span></p>
                <select value={st} onChange={(e) => setAccessItem(a.key, e.target.value, a.method)} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-chalk-200">
                  {["NOT_REQUESTED", "REQUESTED", "RECEIVED", "VERIFIED", "NOT_REQUIRED", "REVOKED", "BLOCKED"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[12.5px] text-chalk-300">{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          );
        })}
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
                <PersistedCheck label={s.label} initial={persisted.runbookState?.steps?.[s.id]?.done ?? false} onToggle={(next) => setRunbookStep(s.id, next)} />
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[12px] text-chalk-500"><span className="text-chalk-400">Rollback:</span> {rb.rollback}</p>
      </Section>

      {/* 4 · QA & DEPLOYMENT */}
      <Section icon={Rocket} title="QA & deployment" accent="text-amber-300">
        <p className="text-[11px] font-semibold uppercase text-chalk-500">QA — required before deploy</p>
        <div className="mt-1">{rb.qaChecklist.map((q, i) => <PersistedCheck key={i} label={q} initial={persisted.qaState[q]?.done ?? false} onToggle={(next) => setQaItem(q, next)} />)}</div>
        <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-200"><Rocket size={13} /> Deploy</p>
          <p className="mt-1 text-[13px] text-chalk-200">{rb.deployMethod}</p>
          <p className="mt-1.5 text-[12px] text-teal-300">Then retest the LIVE production URL — desktop + mobile — before Delivered.</p>
        </div>
      </Section>

      {/* 5 · COMPLETION EVIDENCE */}
      <Section icon={CheckCircle2} title="Completion evidence" accent="text-indigo-300">
        <p className="text-[12.5px] text-chalk-400">Attach actual proof (before / after / production test) — the completion report derives only from what's recorded here. No fabricated results.</p>
        <p className="mt-1 text-[11.5px] text-amber-300">When capturing screenshots, never include passwords, tokens, or account credentials in the frame.</p>
        {persisted.evidence.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-chalk-500">No evidence recorded yet. Required: {packet.completionEvidenceRequired.join(" · ")}.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-[12.5px] text-chalk-200">
            {persisted.evidence.map((e) => (
              <li key={e.id} className="flex items-start gap-2"><span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-chalk-400">{e.kind}</span><span>{e.label} — <span className="text-chalk-500">{e.demonstrates}</span></span></li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11.5px] text-chalk-600">Upload evidence via POST /api/quick-fix/fulfillment/{packet.offerId}/evidence (multipart file + kind + demonstrates).</p>
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

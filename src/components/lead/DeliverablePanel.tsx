"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Eye, Check, Send, Save, Trash2, Plus, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import {
  generateBriefAction,
  updateDeliverableAction,
  approveDeliverableAction,
  markDeliverableSentAction,
  setDeliverableRangeAction,
} from "@/lib/actions";
import type { Lead, Deliverable, DeliverableContent } from "@/lib/types";

export function DeliverablePanel({ lead, deliverables, findingsCount }: { lead: Lead; deliverables: Deliverable[]; findingsCount: number }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const deliverable = deliverables.at(-1);

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-chalk-100">Modernization Brief</h2>
          <p className="text-xs text-chalk-500">A complimentary, branded sales deliverable. Requires your approval before export.</p>
        </div>
        {deliverable && <StatusChip status={deliverable.status} />}
      </div>

      {!deliverable ? (
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="secondary" onRun={() => generateBriefAction(lead.id, "Quick Snapshot").then(refresh)}>
            <FileText size={15} /> Generate Quick Snapshot (Tier B)
          </ActionButton>
          <ActionButton variant="primary" onRun={() => generateBriefAction(lead.id, "Modernization Brief").then(refresh)}>
            <FileText size={15} /> Generate Modernization Brief (Tier A)
          </ActionButton>
          {findingsCount === 0 && <p className="w-full text-xs text-amber-300/80">Tip: approve some findings first so the brief cites real evidence.</p>}
        </div>
      ) : (
        <DeliverableEditor lead={lead} deliverable={deliverable} onRefresh={refresh} />
      )}
    </div>
  );
}

function StatusChip({ status }: { status: Deliverable["status"] }) {
  const map = {
    draft: "border-white/10 text-chalk-400",
    approved: "border-emerald-400/30 text-emerald-300",
    sent: "border-azure-500/30 text-azure-300",
  } as const;
  return <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${map[status]}`}>{status}</span>;
}

function DeliverableEditor({ lead, deliverable, onRefresh }: { lead: Lead; deliverable: Deliverable; onRefresh: () => void }) {
  const [c, setC] = useState<DeliverableContent>(deliverable.content);
  const [dirty, setDirty] = useState(false);
  const editable = deliverable.status !== "sent";

  const patch = (updater: (draft: DeliverableContent) => void) => {
    setC((prev) => {
      const next = structuredClone(prev);
      updater(next);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    await updateDeliverableAction(deliverable.id, lead.id, c);
    setDirty(false);
    onRefresh();
  };

  return (
    <div className="space-y-5">
      {/* Automated QC status */}
      {deliverable.qc && <QcBanner qc={deliverable.qc} status={deliverable.status} />}

      {/* Explainable investment model */}
      {c.modernizationPath.investmentModel && <InvestmentBreakdown model={c.modernizationPath.investmentModel} />}

      {/* Executive snapshot */}
      <Section title="Executive snapshot">
        <TextArea label="Overview" value={c.executiveSnapshot.overview} disabled={!editable} onChange={(v) => patch((d) => { d.executiveSnapshot.overview = v; })} />
        <TextArea label="Primary opportunity" value={c.executiveSnapshot.primaryOpportunity} disabled={!editable} onChange={(v) => patch((d) => { d.executiveSnapshot.primaryOpportunity = v; })} />
        <TextArea label="Potential impact" value={c.executiveSnapshot.potentialImpact} disabled={!editable} onChange={(v) => patch((d) => { d.executiveSnapshot.potentialImpact = v; })} />
      </Section>

      {/* Strengths */}
      <Section title="What's working">
        <LineList lines={c.strengths} disabled={!editable} onChange={(lines) => patch((d) => { d.strengths = lines; })} />
      </Section>

      {/* Opportunities */}
      <Section title={`Key opportunities (${c.opportunities.length})`}>
        {c.opportunities.map((o, i) => (
          <div key={i} className="rounded-lg border border-white/[0.06] p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase text-chalk-600">Opportunity {i + 1}</span>
              {editable && (
                <button onClick={() => patch((d) => { d.opportunities.splice(i, 1); })} className="text-red-300/70 hover:text-red-300"><Trash2 size={13} /></button>
              )}
            </div>
            <input value={o.observation} disabled={!editable} onChange={(e) => patch((d) => { d.opportunities[i].observation = e.target.value; })} className="input text-sm" placeholder="Observation" />
            <input value={o.evidence} disabled={!editable} onChange={(e) => patch((d) => { d.opportunities[i].evidence = e.target.value; })} className="input text-xs" placeholder="Evidence" />
          </div>
        ))}
      </Section>

      {/* Investment range */}
      <div className="flex items-center justify-between rounded-lg border border-white/[0.06] p-3">
        <div>
          <p className="text-sm text-chalk-200">Include preliminary investment range</p>
          <p className="text-xs text-chalk-500">Internal until you approve sharing. Currently: {c.modernizationPath.investmentRange ?? "hidden"}</p>
        </div>
        <ActionButton
          variant={c.modernizationPath.investmentRange ? "secondary" : "primary"}
          disabled={!editable}
          onRun={() => setDeliverableRangeAction(deliverable.id, lead.id, !c.modernizationPath.investmentRange).then(onRefresh)}
        >
          {c.modernizationPath.investmentRange ? "Hide range" : "Include range"}
        </ActionButton>
      </div>

      {/* CTA */}
      <Section title="Conversation CTA">
        <input value={c.cta.headline} disabled={!editable} onChange={(e) => patch((d) => { d.cta.headline = e.target.value; })} className="input font-medium" />
        <TextArea label="" value={c.cta.body} disabled={!editable} onChange={(v) => patch((d) => { d.cta.body = v; })} />
      </Section>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
        {editable && (
          <ActionButton variant="secondary" disabled={!dirty} onRun={save}>
            <Save size={15} /> {dirty ? "Save changes" : "Saved"}
          </ActionButton>
        )}
        <a href={`/api/deliverable/${deliverable.id}/pdf`} target="_blank" rel="noreferrer" className="btn-secondary">
          <Eye size={15} /> Preview PDF
        </a>
        <a href={`/api/deliverable/${deliverable.id}/pdf?download=1`} className="btn-secondary">
          <FileText size={15} /> Export PDF
        </a>
        {deliverable.status === "draft" && (
          <ActionButton variant="primary" onRun={() => approveDeliverableAction(deliverable.id, lead.id).then(onRefresh)}>
            <Check size={15} /> Approve
          </ActionButton>
        )}
        {deliverable.status === "approved" && (
          <ActionButton variant="primary" onRun={() => markDeliverableSentAction(deliverable.id, lead.id).then(onRefresh)}>
            <Send size={15} /> Mark as sent
          </ActionButton>
        )}
        {dirty && <span className="text-xs text-amber-300/80">Save before previewing to see edits.</span>}
      </div>
    </div>
  );
}

function QcBanner({ qc, status }: { qc: NonNullable<Deliverable["qc"]>; status: Deliverable["status"] }) {
  const failed = !qc.passed;
  const blockers = qc.checks.filter((c) => !c.passed && c.severity === "blocker");
  const warnings = qc.checks.filter((c) => !c.passed && c.severity === "warning");
  return (
    <div className={`rounded-lg border p-3 ${failed ? "border-red-400/30 bg-red-500/[0.04]" : "border-emerald-400/25 bg-emerald-500/[0.04]"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {failed ? <ShieldAlert size={16} className="text-red-300" /> : <ShieldCheck size={16} className="text-emerald-300" />}
          <span className="text-sm font-medium text-chalk-100">Quality control</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${failed ? "border-red-400/30 text-red-300" : "border-emerald-400/30 text-emerald-300"}`}>
            {failed ? "Needs attention" : "Passed"} · {qc.score}/100
          </span>
        </div>
        <span className="text-[10px] text-chalk-600">{qc.checks.length} checks · {qc.attempts} pass{qc.attempts === 1 ? "" : "es"}</span>
      </div>
      <p className="mt-1 text-xs text-chalk-500">{qc.summary}</p>
      {failed && status === "draft" && (
        <p className="mt-1 text-[11px] text-amber-300/80">Approval is blocked until these clear. Editing + saving re-runs QC and auto-repairs what it can.</p>
      )}
      {(blockers.length > 0 || warnings.length > 0) && (
        <ul className="mt-2 space-y-1">
          {blockers.slice(0, 6).map((c) => (
            <li key={c.id} className="flex items-start gap-1.5 text-[11px] text-red-200/90">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" /> <span><b>{c.label}:</b> {c.issues[0]?.message}{c.issues.length > 1 ? ` (+${c.issues.length - 1} more)` : ""}</span>
            </li>
          ))}
          {warnings.slice(0, 4).map((c) => (
            <li key={c.id} className="flex items-start gap-1.5 text-[11px] text-amber-200/80">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> <span><b>{c.label}:</b> {c.issues[0]?.message}{c.issues.length > 1 ? ` (+${c.issues.length - 1} more)` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InvestmentBreakdown({ model }: { model: NonNullable<DeliverableContent["modernizationPath"]["investmentModel"]> }) {
  const fmt = (n: number) => `$${n.toLocaleString()}`;
  return (
    <div className="rounded-lg border border-white/[0.06] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="label !mb-0">Investment model · explained</p>
        <span className="text-sm font-semibold text-chalk-100">{model.rangeLabel}</span>
      </div>
      <p className="mb-2 text-[11px] text-chalk-500">{model.explanation}</p>
      <div className="space-y-2">
        {model.lineItems.map((li, i) => (
          <div key={li.id} className="rounded-md border border-white/[0.05] bg-white/[0.015] p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-chalk-600">Item {i + 1} · {li.effort.complexity}</span>
              <span className="text-xs font-medium text-chalk-200">{fmt(li.investmentLow)}–{fmt(li.investmentHigh)}</span>
            </div>
            <p className="mt-1 text-xs text-chalk-300"><span className="text-chalk-600">Observation → </span>{li.observation}</p>
            <p className="text-xs text-chalk-300"><span className="text-chalk-600">Impact → </span>{li.businessImpact}</p>
            <p className="text-xs text-chalk-300"><span className="text-chalk-600">Recommendation → </span>{li.recommendation}</p>
            <p className="text-xs text-chalk-300"><span className="text-chalk-600">Effort → </span>{li.effort.summary} ({li.effort.lowHours}–{li.effort.highHours} hrs)</p>
            <p className="text-xs text-chalk-300"><span className="text-chalk-600">Outcome → </span>{li.expectedOutcome}</p>
            <p className="mt-0.5 text-[10px] text-chalk-600">{li.rateBasis}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-chalk-600">{model.discoveryNote}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label mb-2">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function TextArea({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block">
      {label && <span className="field-label">{label}</span>}
      <textarea value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} rows={2} className="input text-sm" />
    </label>
  );
}

function LineList({ lines, onChange, disabled }: { lines: string[]; onChange: (lines: string[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-1.5">
          <input value={line} disabled={disabled} onChange={(e) => onChange(lines.map((l, j) => (j === i ? e.target.value : l)))} className="input text-sm" />
          {!disabled && <button onClick={() => onChange(lines.filter((_, j) => j !== i))} className="btn-ghost !px-2"><Trash2 size={13} /></button>}
        </div>
      ))}
      {!disabled && (
        <button onClick={() => onChange([...lines, ""])} className="btn-ghost !px-2 !py-1 text-xs"><Plus size={13} /> Add line</button>
      )}
    </div>
  );
}

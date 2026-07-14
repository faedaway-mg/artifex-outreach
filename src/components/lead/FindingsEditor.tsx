"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { FindingTypeBadge, ConfidenceBadge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import {
  toggleFindingApproval,
  removeFindingAction,
  updateFindingAction,
  removeScreenshotAction,
} from "@/lib/actions";
import { FINDING_TYPES, CONFIDENCE, type Finding, type Screenshot } from "@/lib/types";

export function FindingsEditor({ leadId, findings, screenshots }: { leadId: string; findings: Finding[]; screenshots: Screenshot[] }) {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const refresh = () => router.refresh();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-chalk-100">Key opportunities</h2>
          <p className="text-xs text-chalk-500">Approve genuine findings; remove weak ones before generating a deliverable.</p>
        </div>
        <span className="text-xs text-chalk-500">{findings.filter((f) => f.approved).length}/{findings.length} approved</span>
      </div>

      {findings.length === 0 ? (
        <p className="text-sm text-chalk-500">No findings yet. Run website analysis to generate evidence-backed opportunities.</p>
      ) : (
        <div className="space-y-3">
          {findings.map((f) =>
            editId === f.id ? (
              <form
                key={f.id}
                action={updateFindingAction.bind(null, f.id, leadId)}
                onSubmit={() => setTimeout(() => { setEditId(null); refresh(); }, 300)}
                className="rounded-xl border border-azure-500/30 bg-azure-500/[0.03] p-3 space-y-2"
              >
                <input name="title" defaultValue={f.title} className="input font-medium" />
                <textarea name="observation" defaultValue={f.observation} rows={2} className="input" placeholder="Observation" />
                <textarea name="evidence" defaultValue={f.evidence} rows={2} className="input" placeholder="Evidence" />
                <textarea name="businessImpact" defaultValue={f.businessImpact} rows={2} className="input" placeholder="Business impact" />
                <textarea name="modernizationDirection" defaultValue={f.modernizationDirection} rows={2} className="input" placeholder="Modernization direction" />
                <div className="grid grid-cols-2 gap-2">
                  <select name="findingType" defaultValue={f.findingType} className="input text-xs">
                    {FINDING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select name="confidence" defaultValue={f.confidence} className="input text-xs">
                    {CONFIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditId(null)} className="btn-ghost text-xs"><X size={13} /> Cancel</button>
                  <button type="submit" className="btn-primary text-xs"><Check size={13} /> Save & approve</button>
                </div>
              </form>
            ) : (
              <div key={f.id} className={`rounded-xl border p-3 ${f.approved ? "border-emerald-400/20 bg-emerald-400/[0.02]" : "border-white/[0.06]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-chalk-100">{f.title}</h3>
                      <FindingTypeBadge type={f.findingType} />
                      <ConfidenceBadge confidence={f.confidence} />
                    </div>
                    <p className="mt-1.5 text-xs text-chalk-500">{f.category}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <ActionButton variant="ghost" className="!px-2 !py-1" onRun={() => toggleFindingApproval(f.id, leadId).then(refresh)}>
                      <Check size={14} className={f.approved ? "text-emerald-400" : "text-chalk-500"} />
                    </ActionButton>
                    <button onClick={() => setEditId(f.id)} className="btn-ghost !px-2 !py-1"><Pencil size={13} /></button>
                    <ActionButton variant="ghost" className="!px-2 !py-1" confirm="Remove this finding?" onRun={() => removeFindingAction(f.id, leadId).then(refresh)}>
                      <Trash2 size={13} className="text-red-300/70" />
                    </ActionButton>
                  </div>
                </div>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <Field label="Observation" value={f.observation} />
                  <Field label="Evidence" value={f.evidence} />
                  <Field label="Business impact" value={f.businessImpact} />
                  <Field label="Modernization direction" value={f.modernizationDirection} />
                </dl>
              </div>
            ),
          )}
        </div>
      )}

      {/* Screenshots */}
      {screenshots.length > 0 && (
        <div className="mt-5">
          <p className="label mb-2">Captured screenshots</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {screenshots.map((s) => (
              <div key={s.id} className="group relative overflow-hidden rounded-xl border border-white/[0.06]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.storageUrl} alt={s.caption} className="aspect-[4/3] w-full object-cover" />
                <div className="p-2">
                  <p className="truncate text-[11px] text-chalk-400">{s.caption}</p>
                  <span className="text-[10px] uppercase text-chalk-600">{s.viewport}</span>
                </div>
                <ActionButton
                  variant="danger"
                  className="absolute right-1.5 top-1.5 !hidden !px-1.5 !py-1 group-hover:!inline-flex"
                  confirm="Remove this screenshot?"
                  onRun={() => removeScreenshotAction(s.id, leadId).then(refresh)}
                >
                  <Trash2 size={12} />
                </ActionButton>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-chalk-600">{label}</dt>
      <dd className="mt-0.5 text-chalk-300">{value}</dd>
    </div>
  );
}

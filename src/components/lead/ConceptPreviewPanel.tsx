"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Palette, Sparkles, Check, Link2, Copy, Ban, Archive, ExternalLink, AlertTriangle, Eye } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import {
  createConceptPreviewAction, approveFactsAction, generateConceptAction, approveConceptAction,
  createShareAction, revokeShareAction, archivePreviewAction,
} from "@/lib/concept-actions";
import { PREVIEW_TYPES, VISUAL_DIRECTIONS, TARGET_ACTIONS } from "@/lib/types";
import type { ConceptPreview, ConceptPreviewVersion, ConceptPreviewShare, Finding } from "@/lib/types";

interface ValResult { valid: boolean; criticalCount: number; warningCount: number; issues: { rule: string; severity: string; message: string }[] }

export function ConceptPreviewPanel({ leadId, tier, preview, version, shares, findings, appUrl }: {
  leadId: string; tier: string | null; preview: ConceptPreview | null; version: ConceptPreviewVersion | null;
  shares: ConceptPreviewShare[]; findings: Finding[]; appUrl: string;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const eligible = tier === "A" || tier === "B";
  const validation = version?.validationResults as ValResult | undefined;

  return (
    <div className="card p-5" id="concept">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100"><Palette size={16} className="text-indigo-300" /> Concept Website Preview</h2>
          <p className="text-xs text-chalk-500">A focused, clearly-labeled concept to start a conversation — never a free website. Approved public facts only; nothing is shared without your approval.</p>
        </div>
        {preview && <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-chalk-400">{preview.status}</span>}
      </div>

      {!preview ? (
        <form action={createConceptPreviewAction.bind(null, leadId)} onSubmit={() => setTimeout(refresh, 400)} className="space-y-3">
          <p className={`text-xs ${eligible ? "text-teal-300/80" : "text-amber-300/80"}`}>
            {tier === "A" ? "Tier A — recommended." : tier === "B" ? "Tier B — available manually." : "Tier C / unscored — disabled by default; check override to proceed."}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block"><span className="field-label">Preview type</span><select name="previewType" className="input text-xs">{PREVIEW_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="block"><span className="field-label">Visual direction</span><select name="visualDirection" className="input text-xs">{VISUAL_DIRECTIONS.map((v) => <option key={v}>{v}</option>)}</select></label>
            <label className="block"><span className="field-label">Target action</span><select name="targetAction" className="input text-xs">{TARGET_ACTIONS.map((a) => <option key={a}>{a}</option>)}</select></label>
          </div>
          {!eligible && <label className="flex items-center gap-2 text-xs text-chalk-400"><input type="checkbox" name="override" value="true" className="accent-amber-500" /> Override eligibility (Jordan approval)</label>}
          <button type="submit" className="btn-primary text-xs"><Sparkles size={14} /> Start concept preview</button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 rounded-lg border border-white/[0.06] p-3 text-xs sm:grid-cols-3">
            <p><span className="text-chalk-500">Type:</span> <span className="text-chalk-200">{preview.previewType}</span></p>
            <p><span className="text-chalk-500">Direction:</span> <span className="text-chalk-200">{preview.visualDirection}</span></p>
            <p><span className="text-chalk-500">Target:</span> <span className="text-chalk-200">{preview.targetAction}</span></p>
            <p><span className="text-chalk-500">Generations:</span> <span className="text-chalk-200">{preview.generationCount}/3</span></p>
            <p><span className="text-chalk-500">Cost:</span> <span className="text-chalk-200">${preview.totalGenerationCost.toFixed(2)}</span></p>
            <p><span className="text-chalk-500">Eligibility:</span> <span className="text-chalk-200">{tier ?? "—"}</span></p>
          </div>

          {/* Step: Preparing Facts → approve facts */}
          {preview.status === "Preparing Facts" && (
            <form action={approveFactsAction.bind(null, preview.id)} onSubmit={() => setTimeout(refresh, 400)} className="space-y-2">
              <p className="label">Review public facts</p>
              {preview.sourceFacts.map((f) => (
                <div key={f.key} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-xs text-chalk-500">{f.label}</span>
                  <input name={`value_${f.key}`} defaultValue={f.value} className="input flex-1 text-xs" placeholder={f.status === "placeholder" ? "(optional)" : ""} />
                  <select name={`status_${f.key}`} defaultValue={f.status} className="input !w-auto text-xs">
                    <option value="confirmed">Confirmed public</option>
                    <option value="jordan">Jordan-provided</option>
                    <option value="inference">Inference</option>
                    <option value="placeholder">Placeholder</option>
                    <option value="omitted">Omit</option>
                  </select>
                </div>
              ))}
              {findings.length > 0 && (
                <div>
                  <p className="label mt-2 mb-1">Include modernization directions</p>
                  {findings.map((f) => <label key={f.id} className="flex items-center gap-2 text-xs text-chalk-300"><input type="checkbox" name="finding" value={f.id} className="accent-azure-500" /> {f.title}</label>)}
                </div>
              )}
              <button type="submit" className="btn-secondary text-xs"><Check size={13} /> Approve facts</button>
            </form>
          )}

          {/* Step: Drafting → generate */}
          {preview.status === "Drafting" && (
            <ActionButton variant="primary" onRun={() => generateConceptAction(preview.id).then(refresh)}><Sparkles size={14} /> Generate concept (~$0.04)</ActionButton>
          )}

          {/* Step: Generated → validation + review + approve */}
          {(preview.status === "Generated" || preview.status === "Internal Review") && version && (
            <div className="space-y-3">
              <ValidationView v={validation} />
              <div className="flex flex-wrap gap-2">
                <a href={`/api/concept/version/${version.id}`} target="_blank" rel="noreferrer" className="btn-secondary text-xs"><Eye size={13} /> Review (desktop/mobile)</a>
                {preview.generationCount < 3 && <ActionButton variant="secondary" className="text-xs" onRun={() => generateConceptAction(preview.id).then(refresh)}><Sparkles size={13} /> Regenerate</ActionButton>}
                {validation?.valid && <ActionButton variant="primary" className="text-xs" onRun={() => approveConceptAction(preview.id).then(refresh)}><Check size={13} /> Approve concept</ActionButton>}
                {!validation?.valid && <span className="flex items-center gap-1 text-xs text-coral-300"><AlertTriangle size={13} /> Fix critical issues before approving</span>}
              </div>
            </div>
          )}

          {/* Step: Approved → create secure link */}
          {(preview.status === "Approved" || preview.status === "Shared" || preview.status === "Viewed") && (
            <div className="space-y-3">
              {version && <a href={`/api/concept/version/${version.id}`} target="_blank" rel="noreferrer" className="btn-secondary text-xs"><Eye size={13} /> Review rendered concept</a>}
              <CreateLink onCreate={async (days) => { const r = await createShareAction(preview.id, days); if ("token" in r) { setShareUrl(`${appUrl}/share/previews/${r.token}`); refresh(); } }} />
              {shareUrl && (
                <div className="rounded-lg border border-teal-400/30 bg-teal-400/[0.05] p-3">
                  <p className="mb-1 text-xs text-teal-200">Secure link created (shown once):</p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={shareUrl} className="input flex-1 text-xs" />
                    <button onClick={() => { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="btn-secondary text-xs"><Copy size={13} /> {copied ? "Copied" : "Copy"}</button>
                  </div>
                </div>
              )}
              {shares.filter((s) => !s.revokedAt).length > 0 && (
                <div className="space-y-1.5">
                  <p className="label">Active links</p>
                  {shares.filter((s) => !s.revokedAt).map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-lg border border-white/[0.06] p-2 text-xs">
                      <span className="text-chalk-400">Views: {s.viewCount}{s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleDateString()}` : " · no expiry"}</span>
                      <ActionButton variant="danger" className="!px-2 !py-1 text-[11px]" onRun={() => revokeShareAction(s.id, leadId).then(refresh)}><Ban size={12} /> Revoke</ActionButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-white/[0.06] pt-3">
            <ActionButton variant="ghost" className="text-xs" confirm="Archive this preview and revoke its links?" onRun={() => archivePreviewAction(preview.id).then(refresh)}><Archive size={13} /> Archive preview</ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationView({ v }: { v?: ValResult }) {
  if (!v) return null;
  return (
    <div className={`rounded-lg border p-3 text-xs ${v.valid ? "border-teal-400/30 bg-teal-400/[0.04]" : "border-coral-500/30 bg-coral-500/[0.04]"}`}>
      <p className={v.valid ? "text-teal-200" : "text-coral-200"}>
        {v.valid ? "✓ Passed validation" : `${v.criticalCount} critical issue(s) — sharing blocked`}{v.warningCount ? ` · ${v.warningCount} warning(s)` : ""}
      </p>
      {v.issues.filter((i) => i.severity === "critical").slice(0, 5).map((i, idx) => <p key={idx} className="mt-1 text-coral-300/80">• {i.message}</p>)}
    </div>
  );
}

function CreateLink({ onCreate }: { onCreate: (days: number) => Promise<void> }) {
  const [days, setDays] = useState(14);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block"><span className="field-label">Link expires in (days, 0 = never)</span><input type="number" min={0} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} className="input !w-40 text-xs" /></label>
      <ActionButton variant="primary" className="text-xs" onRun={() => onCreate(days)}><Link2 size={13} /> Create secure link</ActionButton>
    </div>
  );
}

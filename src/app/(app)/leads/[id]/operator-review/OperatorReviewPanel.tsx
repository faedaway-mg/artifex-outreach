"use client";
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight operator review — exactly 4 controls: Preview, Approve, Regenerate, Skip/Hold.
// NOT a field editor. Every control reuses an existing, audited, version-bound server action
// (via the revalidating wrappers in ./actions). All copy makes the honest distinction between
// "opened a preview" and "actually inspected", and between "made a draft" and "approved/sent".
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Check, RotateCcw, Pause, Play, ShieldCheck, AlertTriangle, CircleCheck, CircleAlert } from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import type { DeliveryReadiness, ReviewEditorialState, RegenProposal } from "@/lib/outreach/review-revisions";
import type { QuickReview } from "@/lib/outreach/quick-review";
import {
  previewRevalidate,
  approveRevalidate,
  proposeRegenHookRevalidate,
  acceptRegenRevalidate,
  skipRevalidate,
  revisitRevalidate,
} from "./actions";

const STATUS_STYLE: Record<QuickReview["status"], string> = {
  SENDABLE: "border-teal-400/40 bg-teal-400/10 text-teal-300",
  NEEDS_REVIEW: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  INSUFFICIENT_EVIDENCE: "border-coral-400/40 bg-coral-400/10 text-coral-300",
};

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5 text-xs">
      {ok ? <CircleCheck size={13} className="text-teal-300" /> : <CircleAlert size={13} className="text-amber-300" />}
      <span className={ok ? "text-chalk-300" : "text-chalk-400"}>{label}</span>
    </li>
  );
}

export function OperatorReviewPanel({
  leadId,
  review,
  state,
  readiness,
}: {
  leadId: string;
  review: QuickReview;
  state: ReviewEditorialState;
  readiness: DeliveryReadiness;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [proposal, setProposal] = useState<RegenProposal | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const c = readiness.checks;
  const approvedCurrent = state.approval?.revisionId === readiness.revisionId;
  const held = state.held;
  // Approve is blocked unless evidence, editorial, required fields, and a CURRENT preview all hold.
  const approveBlocked = !c.evidenceSatisfied || !c.editorialPasses || !c.requiredFieldsComplete || !c.previewedCurrent;
  const approveBlockReason =
    !c.evidenceSatisfied ? "unsupported or insufficient evidence"
    : !c.editorialPasses ? "a blocking editorial finding is unresolved"
    : !c.requiredFieldsComplete ? "a required customer-facing field is empty"
    : !c.previewedCurrent ? "open the current preview first"
    : approvedCurrent ? "already approved"
    : null;

  // ── PREVIEW: record the preview, then open the PDF route in a new tab. ──────────────────────────
  const onPreview = async () => {
    setNote(null);
    const res = await previewRevalidate(leadId);
    if (!res.ok) { setNote("Could not record the preview."); return; }
    window.open(`/api/quick-review/${leadId}/pdf`, "_blank", "noopener,noreferrer");
    refresh();
  };

  // ── APPROVE: version-bound to the CURRENT revision. ────────────────────────────────────────────
  const onApprove = async () => {
    setNote(null);
    const res = await approveRevalidate(leadId, readiness.revisionId);
    if (!res.ok) setNote(res.reason ?? "Could not approve.");
    else refresh();
  };

  // ── REGENERATE (opening hook only, honest): propose → show current vs proposed → accept. ────────
  const onPropose = async () => {
    setNote(null);
    setProposal(null);
    const res = await proposeRegenHookRevalidate(leadId);
    if (!res.ok || !res.proposal) { setNote(res.reason ?? "Could not generate an alternative."); return; }
    setProposal(res.proposal);
  };
  const onAcceptProposal = async () => {
    if (!proposal) return;
    setNote(null);
    const res = await acceptRegenRevalidate(leadId, proposal);
    setProposal(null);
    if (!res.ok) setNote(res.reason ?? "Could not accept — regenerate again.");
    else { setNote("New draft created. It is NOT previewed or approved yet."); refresh(); }
  };

  // ── SKIP / HOLD: reason REQUIRED; excludes from delivery without deleting the prospect. ─────────
  const onSkip = async () => {
    setNote(null);
    const reason = window.prompt("Why are you holding this review? (required — excludes it from delivery, does not delete the prospect)");
    if (reason == null) return; // cancelled
    if (!reason.trim()) { setNote("A reason is required to hold a review."); return; }
    const res = await skipRevalidate(leadId, reason.trim());
    if (!res.ok) setNote(res.reason ?? "Could not hold.");
    else refresh();
  };
  const onRevisit = async () => {
    setNote(null);
    const res = await revisitRevalidate(leadId);
    if (!res.ok) setNote(res.reason ?? "Could not revisit.");
    else refresh();
  };

  return (
    <div className="space-y-4">
      {/* Header: business + status + revision + top-line state */}
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[15px] font-semibold text-chalk-50">{review.businessName}</h1>
          <span className="text-xs text-chalk-500">{review.industryLabel}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[review.status]}`}>{review.status}</span>
          {held ? (
            <span className="ml-auto flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-300"><Pause size={12} /> Held</span>
          ) : approvedCurrent ? (
            <span className="ml-auto flex items-center gap-1 rounded-full border border-teal-400/40 bg-teal-400/10 px-2 py-0.5 text-xs text-teal-300"><ShieldCheck size={12} /> Approved</span>
          ) : readiness.ready ? (
            <span className="ml-auto flex items-center gap-1 rounded-full border border-teal-400/40 bg-teal-400/10 px-2 py-0.5 text-xs text-teal-300"><CircleCheck size={12} /> Ready</span>
          ) : (
            <span className="ml-auto flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-300"><CircleAlert size={12} /> Blocked</span>
          )}
        </div>
        <p className="mt-2 font-mono text-[11px] text-chalk-500">revision {readiness.revisionId}</p>

        {/* Readiness checklist */}
        <ul className="mt-3 grid gap-1 sm:grid-cols-2">
          <CheckRow ok={c.eligible} label="Lead eligible" />
          <CheckRow ok={c.evidenceSatisfied} label="Evidence satisfied" />
          <CheckRow ok={c.requiredFieldsComplete} label="Required fields complete" />
          <CheckRow ok={c.editorialPasses} label="Editorial passes" />
          <CheckRow ok={c.renderable} label="Renderable" />
          <CheckRow ok={c.previewedCurrent} label="Current revision previewed" />
          <CheckRow ok={c.approvedCurrent} label="Current revision approved" />
        </ul>

        {/* Blocking reasons */}
        {readiness.reasons.length > 0 && (
          <div className="mt-3 space-y-1">
            {readiness.reasons.map((r, i) => (
              <p key={i} className="flex items-center gap-1.5 text-[11px] text-amber-300/90"><AlertTriangle size={11} /> {r}</p>
            ))}
          </div>
        )}
      </div>

      {/* Transient action note */}
      {note && <div className="card border-azure-500/20 bg-azure-500/[0.05] p-3 text-xs text-chalk-300">{note}</div>}

      {/* Held banner replaces the controls with Revisit */}
      {held ? (
        <div className="card p-5">
          <p className="flex items-center gap-1.5 text-sm text-amber-300"><Pause size={14} /> Held — excluded from delivery (the prospect is not deleted).</p>
          <p className="mt-1.5 text-sm text-chalk-300"><span className="text-chalk-600">Reason:</span> {held.reason}</p>
          <p className="mt-0.5 text-[11px] text-chalk-500">by {held.by} · {new Date(held.at).toLocaleString()}</p>
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <ActionButton variant="secondary" className="text-xs" onRun={onRevisit}><Play size={14} /> Revisit</ActionButton>
          </div>
        </div>
      ) : (
        <>
          {/* The 4 controls */}
          <div className="card p-5">
            <div className="flex flex-wrap items-center gap-2">
              {/* 1 — PREVIEW */}
              <ActionButton variant="secondary" className="text-xs" onRun={onPreview}><Eye size={14} /> Preview PDF</ActionButton>
              {/* 2 — APPROVE */}
              <ActionButton
                variant="primary"
                className="text-xs"
                disabled={approveBlocked || approvedCurrent}
                confirm="Approve this exact revision for delivery? This does not send anything."
                onRun={onApprove}
              >
                <Check size={14} /> {approvedCurrent ? "Approved" : "Approve"}
              </ActionButton>
              {/* 3 — REGENERATE (opening hook) */}
              <ActionButton variant="secondary" className="!px-2 !py-1 text-xs" onRun={onPropose}><RotateCcw size={13} /> Regenerate draft</ActionButton>
              {/* 4 — SKIP / HOLD */}
              <ActionButton variant="danger" className="!px-2 !py-1 text-xs" onRun={onSkip}><Pause size={12} /> Skip / Hold</ActionButton>
            </div>

            {/* Honest labels */}
            <p className="mt-3 text-[11px] leading-relaxed text-chalk-500">
              <span className="text-chalk-400">Preview opens the PDF in a new tab and records that it was opened — opening is NOT the same as visually inspecting it.</span>{" "}
              Approve binds to this exact revision and never sends. Regenerate produces a NEW draft opening hook and never auto-approves or sends.
            </p>
            {approveBlocked && approveBlockReason && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-300/90"><CircleAlert size={11} /> Approve disabled: {approveBlockReason}.</p>
            )}
          </div>

          {/* Regenerate proposal: current vs proposed, before accepting */}
          {proposal && (
            <div className="card border-indigo-400/20 bg-indigo-400/[0.04] p-5">
              <p className="text-[11px] uppercase tracking-wide text-indigo-300">Proposed opening hook — review before accepting</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] text-chalk-600">Current</p>
                  <p className="mt-1 text-sm text-chalk-400">{proposal.current}</p>
                </div>
                <div>
                  <p className="text-[11px] text-chalk-600">Proposed</p>
                  <p className="mt-1 text-sm text-chalk-200">{proposal.proposed}</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-chalk-500">Accepting creates a new draft revision. It will NOT be previewed or approved — you must preview and approve again.</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
                <ActionButton variant="primary" className="text-xs" onRun={onAcceptProposal}><Check size={14} /> Accept new draft</ActionButton>
                <button type="button" className="btn-ghost text-xs" onClick={() => setProposal(null)}>Discard</button>
              </div>
            </div>
          )}

          {/* Approval provenance */}
          {approvedCurrent && state.approval && (
            <div className="card p-4">
              <p className="flex items-center gap-1.5 text-sm text-teal-300"><ShieldCheck size={14} /> Approved for delivery.</p>
              <p className="mt-0.5 text-[11px] text-chalk-500">by {state.approval.approvedBy} · {new Date(state.approval.approvedAt).toLocaleString()}</p>
            </div>
          )}
        </>
      )}

      {/* Findings snapshot (read-only context; this is not an editor) */}
      {review.findings.length > 0 && (
        <div className="card p-5">
          <p className="mb-3 text-[11px] uppercase tracking-wide text-chalk-600">Findings in this revision ({review.findings.length})</p>
          <ul className="space-y-2">
            {review.findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-white/[0.06] p-3">
                <p className="text-sm font-medium text-chalk-200">{f.title}</p>
                <p className="mt-0.5 text-xs text-chalk-400">{f.whyItMatters}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

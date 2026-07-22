// ─────────────────────────────────────────────────────────────────────────────
// The Outcomes workspace — did our recommendations actually work?
//
// Calm and executive. Every completed recommendation gets an outcome review that
// begins "Awaiting Review"; the operator records the before state, what was observed,
// and the evidence, then sets the verdict by hand. Nothing is ever marked successful
// automatically. Failures are shown, not hidden. Cross-engagement patterns appear only
// after repeated evidence, and always cite the businesses behind them.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Trophy, ClipboardCheck, ScrollText, GitCommitHorizontal, BarChart3, Network, FileText, CircleDot, CheckCircle2, AlertTriangle, HelpCircle, Clock,
} from "lucide-react";
import type { RelationshipMemoryItem, OutcomeReviewItem, OutcomeStatus, MemoryConfidence } from "@/lib/types";
import { OUTCOME_STATUSES, MEMORY_CONFIDENCES } from "@/lib/types";
import type { OutcomesDashboard, EvolutionEvent, HealthNarrative, EffectivenessRow, KnowledgePattern, ProposalEvidenceLine } from "@/lib/outcomes";
import { EvidenceTrail } from "@/components/lead/EvidenceTrail";
import { startOutcomeReviewAction, saveOutcomeReviewAction, setOutcomeStatusAction } from "@/lib/outcomes-actions";

export interface ReviewSlot {
  recommendationId: string;
  title: string;
  expectedOutcome: string;
  evidenceMemoryIds: string[];
  review: OutcomeReviewItem | null;
}

const STATUS_STYLE: Record<OutcomeStatus, string> = {
  "Awaiting Review": "border-amber-400/30 text-amber-300",
  Supported: "border-teal-400/30 text-teal-300",
  Mixed: "border-azure-400/30 text-azure-300",
  "Not Supported": "border-coral-400/30 text-coral-300",
  "Insufficient Evidence": "border-white/15 text-chalk-400",
};

function Card({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2"><span className="text-chalk-500">{icon}</span><h2 className="text-sm font-semibold text-chalk-100">{title}</h2></div>
      {hint && <p className="mt-1 text-[12px] text-chalk-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const inputCls = "w-full rounded-lg border border-white/10 bg-ink-950/40 px-2.5 py-1.5 text-[13px] text-chalk-200 placeholder:text-chalk-600 focus:border-azure-400/40 focus:outline-none";

function ReviewCard({ slot, items, leadId }: { slot: ReviewSlot; items: RelationshipMemoryItem[]; leadId: string }) {
  const r = slot.review;
  if (!r) {
    return (
      <div className="rounded-lg border border-white/[0.06] p-3.5">
        <p className="text-[14px] font-medium text-chalk-100">{slot.title}</p>
        <p className="mt-0.5 text-[12.5px] text-chalk-500">Completed — but we haven't measured whether it worked.</p>
        <form action={startOutcomeReviewAction.bind(null, leadId, slot.recommendationId, slot.title, slot.expectedOutcome)}>
          <button className="mt-2 rounded-md border border-amber-400/25 px-2.5 py-1 text-[12px] text-amber-300 hover:bg-amber-400/[0.06]">Start outcome review</button>
        </form>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-white/[0.06] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[14px] font-medium text-chalk-100">{r.title}</p>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${STATUS_STYLE[r.status]}`}>{r.status}</span>
      </div>

      {/* Hypothesis */}
      <p className="mt-1.5 text-[12.5px] text-chalk-400"><span className="text-chalk-600">Hypothesis · </span>{r.expectedOutcome || "—"}</p>

      {/* The operator's record */}
      <form action={saveOutcomeReviewAction.bind(null, r.id, leadId)} className="mt-2.5 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <textarea name="beforeState" defaultValue={r.beforeState} rows={2} placeholder="Before — how it worked previously" className={inputCls} />
          <textarea name="observedOutcome" defaultValue={r.observedOutcome} rows={2} placeholder="Observed — what actually changed" className={inputCls} />
        </div>
        <input name="expectedOutcome" defaultValue={r.expectedOutcome} placeholder="Expected outcome (the hypothesis)" className={inputCls} />
        <textarea name="evidence" defaultValue={r.evidence} rows={1} placeholder="Evidence — operator note, client conversation, review, system observation" className={inputCls} />
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="unexpectedConsequences" defaultValue={r.unexpectedConsequences} placeholder="Unexpected consequences (optional)" className={inputCls} />
          <input name="lessonsLearned" defaultValue={r.lessonsLearned} placeholder="Lessons learned (optional)" className={inputCls} />
        </div>
        <div className="flex items-center gap-2">
          <select name="confidence" defaultValue={r.confidence} className="rounded-lg border border-white/10 bg-ink-950/40 px-2.5 py-1.5 text-[13px] text-chalk-200">
            {MEMORY_CONFIDENCES.map((c: MemoryConfidence) => <option key={c} value={c}>{c} confidence</option>)}
          </select>
          <button className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-chalk-300 hover:text-chalk-100">Save observations</button>
        </div>
      </form>

      {/* The verdict — always the operator's call */}
      <div className="mt-2.5 border-t border-white/[0.06] pt-2.5">
        <p className="text-[11px] text-chalk-600">Verdict — set only once you have an observation and evidence:</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(OUTCOME_STATUSES.filter((s) => s !== "Awaiting Review") as OutcomeStatus[]).map((s) => (
            <form key={s} action={setOutcomeStatusAction.bind(null, r.id, leadId, s)}>
              <button className={`rounded-md border px-2 py-0.5 text-[11px] hover:bg-white/[0.04] ${r.status === s ? STATUS_STYLE[s] : "border-white/10 text-chalk-400"}`}>{s}</button>
            </form>
          ))}
          {r.status !== "Awaiting Review" && (
            <form action={setOutcomeStatusAction.bind(null, r.id, leadId, "Awaiting Review")}>
              <button className="rounded-md px-2 py-0.5 text-[11px] text-chalk-600 hover:text-chalk-300">Reset</button>
            </form>
          )}
        </div>
      </div>

      <EvidenceTrail memoryIds={slot.evidenceMemoryIds} items={items} />
    </div>
  );
}

export function OutcomesWorkspace({
  slots, dashboard, evolution, narrative, effectiveness, knowledgeGraph, proposalLines, items, leadId,
}: {
  slots: ReviewSlot[];
  dashboard: OutcomesDashboard;
  evolution: EvolutionEvent[];
  narrative: HealthNarrative;
  effectiveness: EffectivenessRow[];
  knowledgeGraph: KnowledgePattern[];
  proposalLines: ProposalEvidenceLine[];
  items: RelationshipMemoryItem[];
  leadId: string;
}) {
  const nothingYet = slots.length === 0 && dashboard.recentlyCompleted.length === 0;

  return (
    <div className="space-y-6">
      {/* ── Executive outcomes dashboard ─────────────────────────────────────── */}
      <Card icon={<Trophy size={16} />} title="Outcomes at a glance" hint="Meaningful progress only — no vanity metrics, no scores.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { label: "Validated", value: dashboard.validated.length, tone: "text-teal-300", icon: <CheckCircle2 size={12} /> },
            { label: "Mixed", value: dashboard.mixed.length, tone: "text-azure-300", icon: <CircleDot size={12} /> },
            { label: "Awaiting review", value: dashboard.awaitingReview.length, tone: "text-amber-300", icon: <Clock size={12} /> },
            { label: "Need follow-up", value: dashboard.needingFollowUp.length, tone: dashboard.needingFollowUp.length ? "text-coral-300" : "text-chalk-400", icon: <AlertTriangle size={12} /> },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center gap-1.5 text-[11px] text-chalk-500">{s.icon} {s.label}</div>
              <p className={`mt-1 text-[18px] font-semibold ${s.tone}`}>{s.value}</p>
            </div>
          ))}
        </div>
        {nothingYet && <p className="mt-3 text-[13px] text-chalk-500">No completed work to measure yet. As roadmap items are marked complete, they arrive here awaiting an outcome review.</p>}
      </Card>

      {/* ── Business health narrative ────────────────────────────────────────── */}
      <Card icon={<ScrollText size={16} />} title="How this business is changing" hint="Drawn only from reviewed outcomes. Nothing hidden.">
        <p className="text-[14px] leading-relaxed text-chalk-200">{narrative.opening}</p>
        {narrative.points.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {narrative.points.map((p, i) => <li key={i} className="flex gap-2 text-[13.5px] text-chalk-300"><span className="mt-1 text-chalk-600">·</span><span>{p}</span></li>)}
          </ul>
        )}
      </Card>

      {/* ── Business evolution timeline ──────────────────────────────────────── */}
      {evolution.length > 0 && (
        <Card icon={<GitCommitHorizontal size={16} />} title="Business evolution" hint="Real recorded change — what was implemented, what was observed.">
          <ul className="space-y-2.5">
            {evolution.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-1 text-[10px] ${e.kind === "observed" ? "text-teal-300" : "text-azure-300"}`}>{e.kind === "observed" ? "◇" : "●"}</span>
                <div>
                  <p className="text-[13.5px] text-chalk-200">{e.title} <span className="text-chalk-600">· {e.kind}</span></p>
                  <p className="text-[12.5px] text-chalk-400">{e.detail}</p>
                  <p className="text-[11px] text-chalk-600">Evidence · {e.evidence}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Outcome reviews ──────────────────────────────────────────────────── */}
      <Card icon={<ClipboardCheck size={16} />} title="Outcome reviews" hint="Every completed recommendation, measured against what we expected.">
        {slots.length > 0 ? (
          <div className="space-y-3">
            {slots.map((s) => <ReviewCard key={s.recommendationId} slot={s} items={items} leadId={leadId} />)}
          </div>
        ) : (
          <p className="text-[13px] text-chalk-500">Nothing to review yet — complete a roadmap item first.</p>
        )}
      </Card>

      {/* ── Recommendation effectiveness (cross-engagement) ──────────────────── */}
      {effectiveness.length > 0 && (
        <Card icon={<BarChart3 size={16} />} title="Recommendation effectiveness" hint="Counts across every engagement — to improve the next recommendation, not to grade anyone.">
          <div className="space-y-2">
            {effectiveness.map((row) => (
              <div key={row.recommendationId} className="rounded-lg border border-white/[0.06] p-2.5">
                <p className="text-[13px] text-chalk-200">{row.title}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-chalk-500">
                  <span>Recommended · <span className="text-chalk-300">{row.recommended}</span></span>
                  <span>Implemented · <span className="text-chalk-300">{row.implemented}</span></span>
                  <span>Reviewed · <span className="text-chalk-300">{row.reviewed}</span></span>
                  <span className="text-teal-300">Supported · {row.supported}</span>
                  <span className="text-azure-300">Mixed · {row.mixed}</span>
                  <span className="text-coral-300">Unsupported · {row.unsupported}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Consulting knowledge graph ───────────────────────────────────────── */}
      {knowledgeGraph.length > 0 && (
        <Card icon={<Network size={16} />} title="What we're learning across businesses" hint="Recorded only after repeated evidence. Each pattern cites the engagements behind it.">
          <div className="space-y-2.5">
            {knowledgeGraph.map((p) => (
              <div key={p.recommendationId} className="rounded-lg border border-teal-400/15 bg-teal-500/[0.03] p-3">
                <p className="text-[13.5px] font-medium text-chalk-100">{p.title}</p>
                <p className="mt-0.5 text-[13px] text-chalk-300">{p.summary}</p>
                <p className="mt-1 text-[11px] text-chalk-600">Supported by {p.supportedCount} engagements · {p.supportingLeadIds.join(", ")}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Adaptive proposal improvement ────────────────────────────────────── */}
      {proposalLines.length > 0 && (
        <Card icon={<FileText size={16} />} title="Evidence future proposals can draw on" hint="Only where accumulated outcomes support it — always with the count of engagements.">
          <ul className="space-y-2">
            {proposalLines.map((l) => (
              <li key={l.recommendationId} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 text-[13px] leading-relaxed text-chalk-300">
                “{l.line}” <span className="text-chalk-600">— {l.engagements} engagements</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Recommendations needing follow-up (surfaced explicitly) */}
      {dashboard.needingFollowUp.length > 0 && (
        <Card icon={<HelpCircle size={16} />} title="Needs another look" hint="Reviewed, but the result didn't hold or the evidence was thin.">
          <ul className="space-y-1.5">
            {dashboard.needingFollowUp.map((b) => (
              <li key={b.recommendationId} className="text-[13px] text-chalk-300">{b.title} <span className="text-chalk-600">· {b.status}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The Business Technology Review — a living consulting document.
//
// Every recommendation is rendered with its full provenance chain: the verified
// memories behind it, the reasoning that connected them, its roadmap placement and
// implementation status, the expected outcome and success metric, any recorded
// outcome evidence, and cross-engagement knowledge support — with measured confidence.
// Nothing appears without traceable evidence. Beneath it sits the living proposal,
// which excludes completed work and stays a draft until the operator exports it.
// ─────────────────────────────────────────────────────────────────────────────
import { ShieldCheck, FileText, ClipboardList } from "lucide-react";
import type { ConsultingDossier, LivingProposal } from "@/lib/engagement";
import type { MemoryConfidence } from "@/lib/types";

const CONF: Record<MemoryConfidence, string> = { High: "text-teal-300", Medium: "text-amber-300", Low: "text-coral-300" };

function RecBlock({ r }: { r: ConsultingDossier["recommendations"][number] }) {
  return (
    <div className="border-t border-white/[0.06] py-4 first:border-t-0 print:break-inside-avoid">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-chalk-100">{r.title}</h3>
        <span className={`shrink-0 text-[11px] ${CONF[r.confidence.label]}`}>{r.confidence.label} confidence · {r.confidence.score}</span>
      </div>
      <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-300">{r.rationale}</p>

      {r.reasoning && (
        <p className="mt-2 text-[12.5px] text-chalk-400"><span className="text-chalk-600">Reasoning · </span>{r.reasoning.because}</p>
      )}

      {/* Evidence — the verified memories behind it */}
      <div className="mt-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Evidence · {r.memories.length} {r.memories.length === 1 ? "memory" : "memories"}</p>
        <ul className="mt-1 space-y-1">
          {r.memories.map((m) => (
            <li key={m.id} className="text-[12.5px] text-chalk-300">
              {m.value} <span className="text-chalk-600">· {m.status} · via {m.source}</span>
            </li>
          ))}
        </ul>
      </div>

      {r.opportunityChain && (
        <p className="mt-2 text-[12px] text-chalk-400"><span className="text-chalk-600">Chain · </span>{r.opportunityChain.nodes.map((n) => n.label).join(" → ")}</p>
      )}

      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
        {r.roadmap && <div><dt className="text-chalk-600">Roadmap</dt><dd className="text-chalk-300">{r.roadmap.phase} · {r.roadmap.status}</dd></div>}
        <div><dt className="text-chalk-600">Expected outcome</dt><dd className="text-chalk-300">{r.expectedOutcome}</dd></div>
        {r.successMetric && <div><dt className="text-chalk-600">Measured by</dt><dd className="text-chalk-300">{r.successMetric.measuredBy}</dd></div>}
        {r.successMetric && <div><dt className="text-chalk-600">Reviewed</dt><dd className="text-chalk-300">{r.successMetric.reviewWhen}</dd></div>}
      </dl>

      {r.outcome && (
        <p className="mt-2 rounded-md border border-teal-400/15 bg-teal-500/[0.03] p-2 text-[12.5px] text-chalk-300">
          <span className="text-teal-300">Outcome · {r.outcome.status}</span> — {r.outcome.observed} <span className="text-chalk-600">({r.outcome.evidence})</span>
        </p>
      )}
      {r.knowledgeSupport && (
        <p className="mt-1.5 text-[12px] text-chalk-400"><span className="text-chalk-600">Across engagements · </span>{r.knowledgeSupport.summary}</p>
      )}
    </div>
  );
}

export function ReviewDocument({ dossier, proposal }: { dossier: ConsultingDossier; proposal: LivingProposal }) {
  if (dossier.recommendations.length === 0) {
    return (
      <section className="card p-5">
        <div className="flex items-center gap-2"><FileText size={16} className="text-chalk-500" /><h2 className="text-sm font-semibold text-chalk-100">Business Technology Review</h2></div>
        <p className="mt-3 text-[13px] text-chalk-500">No evidence-backed recommendations yet. This review fills in as you capture verified memory and the strategist connects it — nothing appears here without traceable evidence.</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Business Technology Review ───────────────────────────────────────── */}
      <section className="card p-6 print:border-0 print:shadow-none">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-azure-300" />
          <h2 className="text-base font-semibold text-chalk-50">Business Technology Review · {dossier.businessName}</h2>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-300">{dossier.narrativeOpening}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] text-chalk-500">
          <ShieldCheck size={12} /> {dossier.verifiedMemoryCount} verified of {dossier.totalMemoryCount} things we've learned
          {dossier.omittedForNoEvidence > 0 && <span> · {dossier.omittedForNoEvidence} idea{dossier.omittedForNoEvidence === 1 ? "" : "s"} held back for lack of evidence</span>}
        </p>
        <div className="mt-3">
          {dossier.recommendations.map((r) => <RecBlock key={r.recommendationId} r={r} />)}
        </div>
      </section>

      {/* ── Living proposal ──────────────────────────────────────────────────── */}
      <section className="card p-6 print:break-before-page print:border-0 print:shadow-none">
        <div className="flex items-center gap-2">
          <ClipboardList size={16} className="text-azure-300" />
          <h2 className="text-base font-semibold text-chalk-50">Proposal · {proposal.businessName}</h2>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-chalk-300">{proposal.intro}</p>
        <p className="mt-1 text-[11.5px] text-chalk-500">{proposal.relationshipMaturity}</p>

        {proposal.delivered.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Already delivered</p>
            <ul className="mt-1 space-y-1">
              {proposal.delivered.map((d, i) => <li key={i} className="text-[13px] text-chalk-300">✓ {d.title}{d.observed ? <span className="text-chalk-600"> — {d.observed}</span> : null}</li>)}
            </ul>
          </div>
        )}

        <div className="mt-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Recommended engagement</p>
          {proposal.recommendations.length > 0 ? (
            <ol className="mt-2 space-y-3">
              {proposal.recommendations.map((r) => (
                <li key={r.recommendationId} className="print:break-inside-avoid">
                  <p className="text-[14px] font-medium text-chalk-100">{r.order}. {r.title}</p>
                  <p className="mt-0.5 text-[13px] text-chalk-300">{r.rationale}</p>
                  <p className="mt-0.5 text-[12.5px] text-chalk-400">Expected · {r.expectedOutcome}{r.measuredBy ? ` · measured by ${r.measuredBy.toLowerCase()}` : ""}</p>
                  <p className="mt-0.5 text-[11.5px] text-chalk-600">{r.confidenceLabel} confidence · grounded in {r.evidenceCount} {r.evidenceCount === 1 ? "memory" : "memories"}</p>
                  {r.knowledgeLine && <p className="mt-0.5 text-[12px] text-teal-300/90">{r.knowledgeLine}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-[13px] text-chalk-500">All current recommendations have been delivered — the next proposal emerges as new opportunities surface.</p>
          )}
        </div>

        {proposal.validatedOutcomes.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">Validated together</p>
            <ul className="mt-1 space-y-1">
              {proposal.validatedOutcomes.map((v, i) => <li key={i} className="text-[13px] text-chalk-300">{v.title} — {v.observed}</li>)}
            </ul>
          </div>
        )}

        <div className="mt-4 border-t border-white/[0.06] pt-3 text-[12.5px] text-chalk-400">
          Entry engagement · ${proposal.investment.entry.toLocaleString()} · 12-month projected ${proposal.investment.twelveMonth.toLocaleString()}
        </div>
        <p className="mt-2 text-[11.5px] text-chalk-600 print:hidden">{proposal.approvalNote}</p>
      </section>
    </div>
  );
}

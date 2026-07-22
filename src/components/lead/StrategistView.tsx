// ─────────────────────────────────────────────────────────────────────────────
// The Strategist surface — a senior consultant quietly organising what we've learned.
//
// Everything shown here traces back to Relationship Memory. Each conclusion carries
// an evidence trail the operator can open to see exactly which memories it rests on,
// when they were learned, who confirmed them, and how sure we are. Contradictions are
// flagged for the operator to resolve — never resolved automatically. Nothing here
// invents certainty.
// ─────────────────────────────────────────────────────────────────────────────
import { Brain, GitBranch, AlertTriangle, Activity, FileText, ScrollText, ShieldCheck } from "lucide-react";
import type { RelationshipMemoryItem, MemoryConfidence } from "@/lib/types";
import type { RelationshipReasoning, ConfidenceRead, HealthSignal } from "@/lib/reasoning";
import { setMemoryStatusAction } from "@/lib/memory-actions";
import { EvidenceTrail } from "@/components/lead/EvidenceTrail";

const CONF_STYLE: Record<MemoryConfidence, string> = { High: "text-teal-300 border-teal-400/30", Medium: "text-amber-300 border-amber-400/30", Low: "text-coral-300 border-coral-400/30" };

function ConfidenceBadge({ c }: { c: ConfidenceRead }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] ${CONF_STYLE[c.label]}`}>
      <ShieldCheck size={11} /> {c.label} · {c.score}
    </span>
  );
}

function Card({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <span className="text-chalk-500">{icon}</span>
        <h2 className="text-sm font-semibold text-chalk-100">{title}</h2>
      </div>
      {hint && <p className="mt-1 text-[12px] text-chalk-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function StrategistView({ reasoning, items, leadId }: { reasoning: RelationshipReasoning; items: RelationshipMemoryItem[]; leadId: string }) {
  const { narrative, inferences, contradictions, opportunityChains, health, recommendations, followUpReferences } = reasoning;
  const empty = items.filter((m) => m.status !== "Superseded" && m.status !== "Resolved").length === 0;

  if (empty) {
    return (
      <Card icon={<Brain size={16} />} title="The read" hint="A strategist's view of the business, drawn entirely from what you've learned.">
        <p className="text-[13px] text-chalk-500">Nothing to reason from yet. Capture memory during a conversation, and this fills in — every conclusion linked to its evidence.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Living narrative ─────────────────────────────────────────────────── */}
      <Card icon={<ScrollText size={16} />} title="Where this business stands" hint="A living account that grows as you learn more. Everything links back to memory.">
        <p className="text-[14px] leading-relaxed text-chalk-200">{narrative.opening}</p>
        <div className="mt-4 space-y-4">
          {narrative.sections.map((s) => (
            <div key={s.key}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-chalk-500">{s.key}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-chalk-300">{s.prose}</p>
              <EvidenceTrail memoryIds={s.memoryIds} items={items} />
            </div>
          ))}
        </div>
      </Card>

      {/* ── Contradictions (operator resolves) ───────────────────────────────── */}
      {contradictions.length > 0 && (
        <Card icon={<AlertTriangle size={16} />} title="Worth reconciling" hint="What they've told us doesn't line up here. You decide which stands — we won't.">
          <div className="space-y-3">
            {contradictions.map((c) => {
              const a = items.find((m) => m.id === c.between[0]);
              const b = items.find((m) => m.id === c.between[1]);
              return (
                <div key={c.id} className="rounded-lg border border-amber-400/20 bg-amber-500/[0.04] p-3">
                  <p className="text-[12px] font-medium text-amber-200">On {c.topic}</p>
                  <p className="mt-1 text-[13px] text-chalk-300">{c.explanation}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {[a, b].map((m) => m && (
                      <div key={m.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2">
                        <p className="text-[12px] text-chalk-200">{m.value}</p>
                        <p className="mt-0.5 text-[10.5px] text-chalk-600">via {m.source} · {m.status}</p>
                        <form action={setMemoryStatusAction.bind(null, m.id, leadId, "Superseded")}>
                          <button className="mt-1.5 rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-chalk-400 hover:text-coral-300">Supersede this one</button>
                        </form>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-chalk-500">{c.prompt}</p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Reasoning (inferences) ───────────────────────────────────────────── */}
      {inferences.length > 0 && (
        <Card icon={<Brain size={16} />} title="What this adds up to" hint="Connections drawn across memories — recognised, not predicted.">
          <div className="space-y-3">
            {inferences.map((inf) => (
              <div key={inf.id} className="border-t border-white/[0.05] pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13.5px] font-medium text-chalk-100">{inf.claim}</p>
                  <ConfidenceBadge c={inf.confidence} />
                </div>
                <p className="mt-0.5 text-[12.5px] text-chalk-400">{inf.because}</p>
                <EvidenceTrail memoryIds={inf.memoryIds} items={items} confidence={inf.confidence} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Opportunity chains ───────────────────────────────────────────────── */}
      {opportunityChains.length > 0 && (
        <Card icon={<GitBranch size={16} />} title="How the pieces connect" hint="Chains, not disconnected issues. The root is grounded; each step after is a likely consequence.">
          <div className="space-y-4">
            {opportunityChains.map((chain) => (
              <div key={chain.id}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-chalk-100">{chain.title}</p>
                  <ConfidenceBadge c={chain.confidence} />
                </div>
                <ol className="mt-2 space-y-1.5">
                  {chain.nodes.map((n, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px]">
                      <span className="mt-1 text-chalk-600">{i === 0 ? "●" : "↓"}</span>
                      <span className="text-chalk-300">
                        {n.label}
                        <span className={`ml-1.5 rounded px-1 py-0.5 text-[9.5px] ${n.observed ? "bg-teal-400/10 text-teal-300" : "bg-white/[0.04] text-chalk-600"}`}>{n.observed ? "observed" : "projected"}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <EvidenceTrail memoryIds={chain.nodes[0]?.memoryIds ?? []} items={items} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Relationship health ───────────────────────────────────────────── */}
        <Card icon={<Activity size={16} />} title="Where the relationship stands" hint="Progress explained by evidence — no arbitrary scores.">
          <ul className="space-y-2.5">
            {health.map((h: HealthSignal) => (
              <li key={h.milestone} className="flex items-start gap-2.5">
                <span className={`mt-0.5 text-[13px] ${h.reached ? "text-teal-300" : "text-chalk-700"}`}>{h.reached ? "●" : "○"}</span>
                <div>
                  <p className={`text-[13px] ${h.reached ? "text-chalk-200" : "text-chalk-500"}`}>{h.milestone}</p>
                  <p className="text-[11.5px] text-chalk-600">{h.evidence}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* ── Adaptive follow-up references ─────────────────────────────────── */}
        <Card icon={<FileText size={16} />} title="Ways back into the conversation" hint="Grounded in confirmed memory — drop one into a follow-up so it feels continuous.">
          {followUpReferences.length > 0 ? (
            <ul className="space-y-2.5">
              {followUpReferences.map((r, i) => (
                <li key={i} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5 text-[13px] leading-relaxed text-chalk-300">
                  “{r.sentence}”
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-chalk-500">Nothing confirmed enough to reference yet. Verify a memory or two first.</p>
          )}
        </Card>
      </div>

      {/* ── Reasoned recommendations (consultant review) ─────────────────────── */}
      {recommendations.length > 0 && (
        <Card icon={<ShieldCheck size={16} />} title="Recommendations, with the reasoning" hint="Review before anything reaches a proposal. Each one traces to evidence; none leaves without your approval.">
          <div className="space-y-4">
            {recommendations.map((r) => (
              <div key={r.id} className="rounded-lg border border-white/[0.06] p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] font-medium text-chalk-100">{r.title}</p>
                  <ConfidenceBadge c={r.confidence} />
                </div>
                <p className="mt-1 text-[13px] text-chalk-300">{r.rationale}</p>
                <dl className="mt-2.5 grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
                  <div><dt className="text-chalk-600">Observed impact</dt><dd className="text-chalk-300">{r.observedImpact}</dd></div>
                  <div><dt className="text-chalk-600">Expected outcome</dt><dd className="text-chalk-300">{r.suggestedOutcome}</dd></div>
                  <div><dt className="text-chalk-600">Depends on</dt><dd className="text-chalk-300">{r.dependencies.join("; ")}</dd></div>
                  <div><dt className="text-chalk-600">Effort</dt><dd className="text-chalk-300">{r.effort}</dd></div>
                </dl>
                <EvidenceTrail memoryIds={r.evidenceMemoryIds} items={items} confidence={r.confidence} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

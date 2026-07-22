// ─────────────────────────────────────────────────────────────────────────────
// The Roadmap — an executive consulting view of what should happen next.
//
// Calm and minimal: a dashboard read at the top, the business's place in its journey,
// a recommended rollout order, then the full phased roadmap. Every recommendation
// carries its evidence and its reasoning (why now, why not earlier, what blocks it,
// what happens if we wait). The lifecycle only ever advances when the operator says
// so — nothing here moves work on its own.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Rocket, Ban, Zap, Compass, ListOrdered, Activity, Lightbulb, ShieldCheck, CheckCircle2, ChevronRight, Target,
} from "lucide-react";
import type { RelationshipMemoryItem, MemoryConfidence, RoadmapStatus } from "@/lib/types";
import type { RelationshipReasoning, ConfidenceRead } from "@/lib/reasoning";
import type { ExecutionPlan, RoadmapItem, ExecutionPhase } from "@/lib/roadmap";
import { EvidenceTrail } from "@/components/lead/EvidenceTrail";
import { advanceRoadmapAction } from "@/lib/roadmap-actions";

const CONF_STYLE: Record<MemoryConfidence, string> = { High: "text-teal-300 border-teal-400/30", Medium: "text-amber-300 border-amber-400/30", Low: "text-coral-300 border-coral-400/30" };
const PHASE_STYLE: Record<ExecutionPhase, string> = {
  Immediate: "text-teal-300 border-teal-400/30",
  "Near-term": "text-azure-300 border-azure-400/30",
  "Long-term": "text-chalk-300 border-white/15",
  "Future consideration": "text-chalk-500 border-white/10",
  Blocked: "text-coral-300 border-coral-400/30",
  Completed: "text-emerald-300 border-emerald-400/30",
};
const PHASE_ORDER: ExecutionPhase[] = ["Immediate", "Near-term", "Long-term", "Future consideration", "Blocked"];

// The operator-approved lifecycle. Forward one step is an explicit decision.
const LIFECYCLE: RoadmapStatus[] = ["Observed", "Validated", "Recommended", "Approved", "In Progress", "Completed", "Measured"];
const NEXT_LABEL: Partial<Record<RoadmapStatus, string>> = { Recommended: "Approve", Approved: "Start work", "In Progress": "Mark complete", Completed: "Mark measured", Observed: "Validate", Validated: "Recommend" };

function ConfidenceBadge({ c }: { c: ConfidenceRead }) {
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] ${CONF_STYLE[c.label]}`}><ShieldCheck size={11} /> {c.label} · {c.score}</span>;
}

function Card({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2"><span className="text-chalk-500">{icon}</span>{title && <h2 className="text-sm font-semibold text-chalk-100">{title}</h2>}</div>
      {hint && <p className="mt-1 text-[12px] text-chalk-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-chalk-500">{icon} {label}</div>
      <p className={`mt-1 text-[18px] font-semibold ${tone ?? "text-chalk-100"}`}>{value}</p>
    </div>
  );
}

function JournalControls({ item, leadId }: { item: RoadmapItem; leadId: string }) {
  const idx = LIFECYCLE.indexOf(item.status);
  const next = idx >= 0 && idx < LIFECYCLE.length - 1 ? LIFECYCLE[idx + 1] : null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-chalk-400">Status · {item.status}</span>
      {next && (
        <form action={advanceRoadmapAction.bind(null, leadId, item.recommendationId, item.title, next)}>
          <button className="rounded-md border border-teal-400/25 px-2 py-0.5 text-[11px] text-teal-300 hover:bg-teal-400/[0.06]">{NEXT_LABEL[item.status] ?? `→ ${next}`}</button>
        </form>
      )}
      {item.status !== "Recommended" && (
        <form action={advanceRoadmapAction.bind(null, leadId, item.recommendationId, item.title, "Recommended")}>
          <button className="rounded-md px-2 py-0.5 text-[11px] text-chalk-600 hover:text-chalk-300">Reset</button>
        </form>
      )}
    </div>
  );
}

function ItemCard({ item, items, leadId }: { item: RoadmapItem; items: RelationshipMemoryItem[]; leadId: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-medium text-chalk-100">{item.title}</p>
            {item.quickWin && <span className="inline-flex items-center gap-1 rounded-full border border-teal-400/30 px-1.5 py-0.5 text-[10px] text-teal-300"><Zap size={10} /> quick win</span>}
          </div>
          <p className="mt-0.5 text-[13px] text-chalk-400">{item.why}</p>
        </div>
        <ConfidenceBadge c={item.confidence} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-chalk-600">
        <span>Impact · <span className="text-chalk-400">{item.impact}</span></span>
        <span>Effort · <span className="text-chalk-400">{item.effort}</span></span>
      </div>
      {/* Explainability — why now / why not earlier / what blocks / what if we wait */}
      <details className="mt-2 group">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-chalk-500 hover:text-chalk-300">
          <ChevronRight size={12} className="transition-transform group-open:rotate-90" /> The reasoning
        </summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 border-l border-white/10 pl-3 text-[12px] sm:grid-cols-2">
          <div><dt className="text-chalk-600">Why now</dt><dd className="text-chalk-300">{item.explain.whyNow}</dd></div>
          <div><dt className="text-chalk-600">Why not earlier</dt><dd className="text-chalk-300">{item.explain.whyNotEarlier}</dd></div>
          <div><dt className="text-chalk-600">What blocks it</dt><dd className="text-chalk-300">{item.explain.whatBlocks}</dd></div>
          <div><dt className="text-chalk-600">If we wait</dt><dd className="text-chalk-300">{item.explain.whatIfWait}</dd></div>
        </dl>
        <div className="mt-2 border-l border-white/10 pl-3">
          <p className="text-[11px] text-chalk-600">Success looks like</p>
          <p className="text-[12px] text-chalk-300">{item.successMetric.looksLike}</p>
          <p className="mt-1 text-[11px] text-chalk-600">Measured by · <span className="text-chalk-400">{item.successMetric.measuredBy}</span> · reviewed {item.successMetric.reviewWhen.toLowerCase()}</p>
        </div>
      </details>
      <EvidenceTrail memoryIds={item.evidenceMemoryIds} items={items} confidence={item.confidence} />
      <JournalControls item={item} leadId={leadId} />
    </div>
  );
}

export function RoadmapWorkspace({
  plan, reasoning, items, leadId, momentum, recentInsights,
}: {
  plan: ExecutionPlan;
  reasoning: RelationshipReasoning;
  items: RelationshipMemoryItem[];
  leadId: string;
  momentum: { label: string; tone: string };
  recentInsights: RelationshipMemoryItem[];
}) {
  const priorities = plan.items.filter((i) => i.phase === "Immediate");
  const blocked = plan.items.filter((i) => i.phase === "Blocked");
  const quickWins = plan.items.filter((i) => i.quickWin);
  const highConfidence = plan.items.filter((i) => i.confidence.label === "High");
  const longTerm = plan.items.filter((i) => i.phase === "Long-term" || i.phase === "Future consideration");
  const healthReached = reasoning.health.filter((h) => h.reached).length;

  if (plan.items.length === 0 && plan.completed.length === 0) {
    return (
      <Card icon={<Compass size={16} />} title="The plan" hint="What should happen next, sequenced like a consultant would.">
        <p className="text-[13px] text-chalk-500">No recommendations to sequence yet. As reasoning surfaces evidence-backed opportunities, they'll appear here — placed, ordered, and explained.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Executive dashboard ──────────────────────────────────────────────── */}
      <Card icon={<Target size={16} />} title="Executive view" hint="Where things stand, at a glance.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat icon={<Rocket size={12} />} label="Priorities" value={priorities.length} tone="text-teal-300" />
          <Stat icon={<Zap size={12} />} label="Quick wins" value={quickWins.length} tone="text-teal-300" />
          <Stat icon={<Ban size={12} />} label="Blocked" value={blocked.length} tone={blocked.length ? "text-coral-300" : "text-chalk-400"} />
          <Stat icon={<Activity size={12} />} label="Momentum" value={momentum.label} tone={momentum.tone} />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat icon={<ShieldCheck size={12} />} label="High-confidence" value={highConfidence.length} />
          <Stat icon={<Compass size={12} />} label="Long-term" value={longTerm.length} />
          <Stat icon={<CheckCircle2 size={12} />} label="Completed" value={plan.completed.length} tone="text-emerald-300" />
          <Stat icon={<Activity size={12} />} label="Relationship" value={`${healthReached}/${reasoning.health.length}`} />
        </div>
        {recentInsights.length > 0 && (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <p className="flex items-center gap-1.5 text-[11px] text-chalk-500"><Lightbulb size={12} /> Recently learned</p>
            <ul className="mt-1.5 space-y-1">
              {recentInsights.map((m) => (
                <li key={m.id} className="text-[12.5px] text-chalk-300">{m.title} <span className="text-chalk-600">· {m.category}</span></li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── Transformation timeline ──────────────────────────────────────────── */}
      <Card icon={<Compass size={16} />} title="Where this business is in its journey" hint="Discovery through partnership — each stage reached only on evidence.">
        <ol className="flex flex-wrap items-stretch gap-2">
          {plan.transformation.map((s) => (
            <li key={s.key} className={`flex-1 rounded-lg border p-2.5 ${s.current ? "border-azure-400/40 bg-azure-500/[0.05]" : s.reached ? "border-white/[0.08] bg-white/[0.02]" : "border-white/[0.04] opacity-50"}`}>
              <p className={`text-[12px] font-medium ${s.current ? "text-azure-200" : s.reached ? "text-chalk-200" : "text-chalk-600"}`}>
                {s.reached ? "●" : "○"} {s.key}{s.current ? " · now" : ""}
              </p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-chalk-600">{s.evidence}</p>
            </li>
          ))}
        </ol>
      </Card>

      {/* ── Recommended sequence ─────────────────────────────────────────────── */}
      {plan.sequence.length > 0 && (
        <Card icon={<ListOrdered size={16} />} title="Where to start, and why" hint="A rollout order — dependencies first, then leverage.">
          <ol className="space-y-2">
            {plan.sequence.map((s) => (
              <li key={s.recommendationId} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/15 text-[11px] text-chalk-400">{s.order}</span>
                <div><p className="text-[13.5px] text-chalk-200">{s.title}</p><p className="text-[12px] text-chalk-500">{s.reason}</p></div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* ── The phased roadmap ───────────────────────────────────────────────── */}
      {PHASE_ORDER.map((phase) => {
        const group = plan.items.filter((i) => i.phase === phase);
        if (group.length === 0) return null;
        return (
          <Card key={phase} icon={<span className={`rounded-full border px-2 py-0.5 text-[10.5px] ${PHASE_STYLE[phase]}`}>{phase}</span>} title="" >
            <div className="space-y-3">
              {group.map((i) => <ItemCard key={i.recommendationId} item={i} items={items} leadId={leadId} />)}
            </div>
          </Card>
        );
      })}

      {/* ── Completed — carried, never re-recommended ────────────────────────── */}
      {plan.completed.length > 0 && (
        <Card icon={<CheckCircle2 size={16} />} title="Completed" hint="Solved work, kept out of the active plan so it's never recommended again.">
          <div className="space-y-3">
            {plan.completed.map((i) => (
              <div key={i.recommendationId} className="rounded-lg border border-emerald-400/15 bg-emerald-500/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13.5px] font-medium text-chalk-200">{i.title}</p>
                  <span className="text-[11px] text-emerald-300">{i.status}</span>
                </div>
                <p className="mt-0.5 text-[12px] text-chalk-500">Reviewed by: {i.successMetric.measuredBy}</p>
                <JournalControls item={i} leadId={leadId} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

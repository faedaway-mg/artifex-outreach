// Business Intelligence workspace on the lead page. Server component: renders the
// persisted engine profile as a consultant's briefing — scannable, grouped, with
// depth tucked into <details>. The operator sees a complete picture without
// assembling anything by hand.
import {
  Brain,
  Sparkles,
  Gauge,
  TrendingUp,
  Route,
  HelpCircle,
  Layers,
  GitBranch,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { regenerateBusinessIntelligenceAction } from "@/lib/actions";
import type { StoredBusinessIntelligence } from "@/lib/types";

function confTone(c: number): string {
  return c >= 60 ? "text-teal-300" : c >= 40 ? "text-amber-300" : "text-coral-300";
}

export function IntelligencePanel({ bi, leadId }: { bi: StoredBusinessIntelligence | null; leadId: string }) {
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-chalk-100">
          <Brain size={15} className="text-azure-300" /> Business Intelligence
        </h2>
        <form action={regenerateBusinessIntelligenceAction.bind(null, leadId)}>
          <button type="submit" className="btn-ghost !px-2 !py-1 text-xs">
            <RefreshCw size={12} /> {bi ? "Refresh" : "Generate"}
          </button>
        </form>
      </div>

      {!bi ? (
        <p className="text-sm text-chalk-500">
          No intelligence yet. Run website analysis (or Generate) to produce a full Business Technology profile — snapshot, maturity, opportunity graph, evolution plan, and an operator briefing.
        </p>
      ) : (
        <Body bi={bi} />
      )}
    </div>
  );
}

function Body({ bi }: { bi: StoredBusinessIntelligence }) {
  const p = bi.profile;
  const b = p.briefing;
  const rel = p.improvement.relationship;
  const generated = new Date(bi.generatedAt).toLocaleString();

  return (
    <div className="space-y-5">
      {/* Why it matters + next action */}
      <div>
        <p className="text-[11px] uppercase tracking-wide text-chalk-600">Why this lead matters</p>
        <p className="mt-1 text-sm text-chalk-300">{b.whyItMatters}</p>
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-azure-500/20 bg-azure-500/[0.06] p-2.5">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-azure-300" />
          <p className="text-sm text-chalk-200">{b.nextAction}</p>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-3 gap-3">
        <Metric icon={<TrendingUp size={13} />} label="Improvement" value={`${p.improvement.score}/100`} sub={p.improvement.treatment} />
        <Metric icon={<ShieldCheck size={13} />} label="Evidence" value={<span className={confTone(p.evidenceConfidence)}>{p.evidenceConfidence}%</span>} sub="confidence" />
        <Metric icon={<Gauge size={13} />} label="Maturity" value={p.maturity.overall} sub={`${p.maturity.priorityDimensions.length} focus areas`} />
      </div>

      {/* Opportunity story */}
      <Section icon={<Route size={13} />} title="Opportunity story">
        <p className="font-mono text-xs text-chalk-400">{p.opportunityGraph.story}</p>
        {p.opportunityGraph.highLeverage && (
          <p className="mt-1.5 text-sm text-chalk-300">
            <span className="text-chalk-500">Highest leverage:</span> {p.opportunityGraph.highLeverage.domain} — {p.opportunityGraph.highLeverage.rationale}
          </p>
        )}
      </Section>

      {/* Best angle + discovery questions */}
      <Section icon={<HelpCircle size={13} />} title="Discovery prep">
        <p className="text-sm text-chalk-300"><span className="text-chalk-500">Best angle:</span> {b.bestOutreachAngle}</p>
        <ul className="mt-2 space-y-1">
          {b.bestDiscoveryQuestions.map((q, i) => (
            <li key={i} className="text-xs text-chalk-400">• {q}</li>
          ))}
        </ul>
      </Section>

      {/* Technology maturity + evolution */}
      <Section icon={<Layers size={13} />} title="Technology maturity">
        <p className="text-sm text-chalk-300">{p.maturity.summary}</p>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-chalk-500">All {p.maturity.dimensions.length} dimensions</summary>
          <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
            {p.maturity.dimensions.map((d) => (
              <div key={d.dimension} className="flex items-center justify-between text-xs">
                <span className="text-chalk-400">{d.dimension}</span>
                <span className="font-mono text-chalk-300">{d.current}</span>
              </div>
            ))}
          </div>
        </details>
      </Section>

      <Section icon={<GitBranch size={13} />} title="Business evolution">
        <p className="text-sm text-chalk-300">{p.evolution.narrative}</p>
        <p className="mt-1.5 text-xs text-chalk-500">
          Recommended entry: <span className="text-chalk-300">{b.recommendedEngagement}</span> · {b.relationshipPotential}
        </p>
      </Section>

      {/* Provider contributions + contradictions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
        <span className="text-[11px] text-chalk-600">Providers:</span>
        {p.providerCoverage.contributing.map((id) => (
          <span key={id} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-chalk-400">{id}</span>
        ))}
        <span className="ml-auto text-[11px] text-chalk-600">{p.providerCoverage.evidenceCount} evidence · {generated}</span>
      </div>

      {p.contradictions.length > 0 && (
        <div className="space-y-1">
          {p.contradictions.map((c, i) => (
            <p key={i} className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
              <AlertTriangle size={11} /> Conflicting evidence on <span className="font-mono">{c.field}</span> across providers — verify.
            </p>
          ))}
        </div>
      )}

      {/* Enrichment changes */}
      {bi.enrichmentDelta && bi.enrichmentDelta.summary.join(" ") !== "no material change" && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
          <p className="text-[11px] uppercase tracking-wide text-chalk-600">Last enrichment changed</p>
          <p className="mt-1 text-xs text-chalk-300">{bi.enrichmentDelta.summary.join(" · ")}</p>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] p-2.5">
      <p className="flex items-center gap-1 text-[11px] text-chalk-600">{icon} {label}</p>
      <p className="mt-0.5 text-sm font-semibold text-chalk-100">{value}</p>
      <p className="text-[11px] text-chalk-500">{sub}</p>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-chalk-600">{icon} {title}</p>
      {children}
    </div>
  );
}

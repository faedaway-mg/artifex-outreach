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
import type { BusinessProfile, DimensionReport, ReadingStatus } from "@/lib/business-intelligence";

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
        {b.openingConversation && (
          <div className="mt-2 rounded border border-chalk-800 bg-chalk-950/40 p-2.5">
            <p className="text-xs uppercase tracking-wide text-chalk-500">How to open the call</p>
            <p className="mt-1 text-sm leading-relaxed text-chalk-200">{b.openingConversation}</p>
            {b.openingGuardrails.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {b.openingGuardrails.map((g, i) => (
                  <li key={i} className="text-[11px] text-chalk-500">— {g}</li>
                ))}
              </ul>
            )}
          </div>
        )}
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

      {/* Structured Business Intelligence Profile (guarded — absent on records
          generated before the profile engine shipped; they show on Refresh). */}
      <ProfileSection profile={p.businessProfile} />

      {/* Categorized modernization opportunities from the profile */}
      <OpportunitiesSection profile={p.businessProfile} />

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

const STATUS_DOT: Record<ReadingStatus, string> = {
  strong: "bg-teal-300",
  adequate: "bg-azure-300",
  weak: "bg-amber-300",
  absent: "bg-coral-300",
  unknown: "bg-chalk-600",
};

/** Structured four-dimension profile. Guarded: renders only when present. */
function ProfileSection({ profile }: { profile?: BusinessProfile }) {
  if (!profile) return null;
  const dims = Object.values(profile.dimensions) as DimensionReport[];
  return (
    <Section icon={<Brain size={13} />} title="Structured profile">
      <p className="text-sm text-chalk-300">{profile.executiveSummary}</p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {dims.map((d) => (
          <details key={d.dimension} className="rounded-lg border border-white/[0.06] p-2">
            <summary className="flex cursor-pointer items-center justify-between text-xs text-chalk-300">
              <span>{d.label}</span>
              <span className="font-mono text-chalk-500">{d.score === null ? "n/a" : `${d.score}/100`} · {d.measured}/{d.total}</span>
            </summary>
            <ul className="mt-1.5 space-y-1">
              {d.readings.map((r) => (
                <li key={r.key} className="flex items-start gap-1.5 text-[11px] text-chalk-400">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[r.status]}`} />
                  <span><span className="text-chalk-300">{r.label}:</span> {r.summary} <span className="text-chalk-600">({r.confidence.label})</span></span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </Section>
  );
}

/** Categorized modernization opportunities. Guarded: renders only when present. */
function OpportunitiesSection({ profile }: { profile?: BusinessProfile }) {
  if (!profile || profile.opportunities.length === 0) return null;
  return (
    <Section icon={<Sparkles size={13} />} title="Modernization opportunities">
      <ul className="space-y-1.5">
        {profile.opportunities.slice(0, 6).map((o) => (
          <li key={o.id} className="rounded-lg border border-white/[0.06] p-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-azure-500/20 bg-azure-500/[0.06] px-2 py-0.5 text-[10px] uppercase tracking-wide text-azure-200">{o.category}</span>
              <span className="text-[10px] text-chalk-500">{o.estimatedImpact.level} · {o.confidence.label}</span>
            </div>
            <p className="mt-1 text-xs text-chalk-300">{o.observation}</p>
            <p className="mt-0.5 text-[11px] text-chalk-500">{o.whyItMatters}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// The "understand the business first" scorecard — the first thing shown on a lead.
// A calm, scannable read of what Artifex knows: health, improvement potential,
// maturity, evidence confidence, growth, relationship potential, plus observed
// strengths and friction. Reads from the persisted engine profile; falls back to
// lead facts so it is never empty. No commercial framing here — understanding only.
import { Activity, TrendingUp, Gauge, ShieldCheck, Sprout, HeartHandshake, CheckCircle2, AlertCircle } from "lucide-react";
import type { Lead, StoredBusinessIntelligence } from "@/lib/types";
import { levelOrdinal } from "@/lib/intelligence/maturity";
import { cn } from "@/lib/utils";

function meterTone(v: number): string {
  return v >= 66 ? "from-teal-500 to-emerald-400" : v >= 40 ? "from-azure-500 to-indigo-500" : "from-chalk-600 to-chalk-500";
}
function textTone(v: number): string {
  return v >= 66 ? "text-teal-300" : v >= 40 ? "text-azure-300" : "text-chalk-400";
}

function Meter({ icon, label, value, caption }: { icon: React.ReactNode; label: string; value: number; caption?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] text-chalk-400">{icon} {label}</p>
        <span className={cn("font-mono text-sm font-semibold tabular-nums", textTone(value))}>{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cn("h-full rounded-full bg-gradient-to-r", meterTone(value))} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      {caption && <p className="mt-1 text-[10.5px] text-chalk-500">{caption}</p>}
    </div>
  );
}

export function BusinessUnderstanding({ lead, bi }: { lead: Lead; bi: StoredBusinessIntelligence | null }) {
  if (!bi) {
    return (
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-chalk-100">Understanding this business</h2>
        <p className="mt-2 text-sm text-chalk-400">
          No intelligence profile yet. Generate one to see technology maturity, improvement potential, observed strengths and friction, and relationship potential before any outreach.
        </p>
        {lead.strengths.length > 0 && (
          <div className="mt-4">
            <p className="label mb-2">Observed strengths</p>
            <ul className="space-y-1">
              {lead.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-chalk-300"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-400" /> {s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const p = bi.profile;
  const d = p.improvement.dimensions;
  const maturityPct = Math.round((levelOrdinal(p.maturity.overall) / 5) * 100);
  const strengths = p.snapshot.observedStrengths?.length ? p.snapshot.observedStrengths : lead.strengths;
  const friction = p.snapshot.visibleFriction ?? [];

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-chalk-100">Understanding this business</h2>
        <span className="text-[11px] text-chalk-600">{p.maturity.overall} · {p.improvement.treatment}</span>
      </div>

      {/* One-line read */}
      <p className="text-sm leading-relaxed text-chalk-300">{p.briefing.whyItMatters}</p>

      {/* The scorecard */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Meter icon={<TrendingUp size={12} />} label="Improvement potential" value={p.improvement.score} caption={p.improvement.treatment} />
        <Meter icon={<Gauge size={12} />} label="Technology maturity" value={maturityPct} caption={p.maturity.overall} />
        <Meter icon={<ShieldCheck size={12} />} label="Evidence confidence" value={p.evidenceConfidence} caption="public evidence only" />
        <Meter icon={<Activity size={12} />} label="Business health" value={d.businessHealth} caption="credibility & stability" />
        <Meter icon={<Sprout size={12} />} label="Growth signals" value={d.growthSignals} caption="scaling indicators" />
        <Meter icon={<HeartHandshake size={12} />} label="Relationship potential" value={d.recurringPotential} caption={p.briefing.relationshipPotential} />
      </div>

      {/* Strengths + friction, side by side */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="label mb-2 flex items-center gap-1.5"><CheckCircle2 size={12} className="text-emerald-400" /> Observed strengths</p>
          {strengths.length ? (
            <ul className="space-y-1">
              {strengths.slice(0, 5).map((s, i) => <li key={i} className="text-sm text-chalk-300">• {s}</li>)}
            </ul>
          ) : <p className="text-xs text-chalk-500">None recorded yet.</p>}
        </div>
        <div>
          <p className="label mb-2 flex items-center gap-1.5"><AlertCircle size={12} className="text-amber-400" /> Observed friction</p>
          {friction.length ? (
            <ul className="space-y-1">
              {friction.slice(0, 5).map((f, i) => <li key={i} className="text-sm text-chalk-300">• {f.observation}</li>)}
            </ul>
          ) : <p className="text-xs text-chalk-500">No visible friction recorded.</p>}
        </div>
      </div>
    </div>
  );
}

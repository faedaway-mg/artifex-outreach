// Phase 5 — First 100 Businesses mode. A campaign-scoped lens built to learn fast.
import { firstHundred } from "@/lib/launch/first100";
import { metric } from "@/lib/launch/types";
import { MetricStat, Breakdown } from "@/components/launch/LaunchUI";
import { SectionHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FirstHundredPage() {
  const f = await firstHundred(100);

  return (
    <div className="space-y-8">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-chalk-100">First {f.target} businesses</p>
            <p className="text-xs text-chalk-500">Cohort of {f.cohortSize} earliest-discovered businesses · {f.contacted} contacted ({f.progressPct}% of target).</p>
          </div>
          <span className="font-mono text-sm tabular-nums text-chalk-200">{f.progressPct}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-gradient-to-r from-azure-500 to-teal-400" style={{ width: `${Math.min(100, f.progressPct)}%` }} />
        </div>
      </div>

      <section>
        <SectionHeader title="Funnel" subtitle="Learn as fast as possible from the first cohort." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricStat metric={metric("Analyzed", f.analyzed)} tone="azure" />
          <MetricStat metric={metric("Contacted", f.contacted)} />
          <MetricStat metric={metric("Replies", f.replies)} tone="emerald" />
          <MetricStat metric={metric("Discovery calls", f.discoveryCalls)} tone="indigo" />
          <MetricStat metric={metric("Projects won", f.projectsWon)} tone="teal" />
          <MetricStat metric={metric("Recommendation accuracy", f.recommendationAccuracy, false)} />
        </div>
      </section>

      <section>
        <SectionHeader title="What we're learning" subtitle="Objections, friction, and requests from the first cohort." />
        <div className="grid gap-6 lg:grid-cols-2">
          <Breakdown title="Most common friction discovered" data={f.commonFriction} empty="No analyzed businesses in cohort yet." />
          <Breakdown title="Most common objections" data={f.commonObjections} empty="No objections captured yet." />
          <Breakdown title="Most requested improvements (proxy: surfaced opportunities)" data={f.requestedImprovements} empty="No opportunities surfaced yet." />
          <Breakdown title="Reasons businesses declined" data={f.declineReasons} empty="No declines yet." />
        </div>
      </section>

      <section>
        <SectionHeader title="Operator observations" subtitle="Notes captured on cohort leads and meetings." />
        <div className="card p-5">
          {f.operatorObservations.length === 0 ? (
            <p className="text-xs text-chalk-600">No operator notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {f.operatorObservations.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-chalk-300"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-chalk-600" />{o}</li>
              ))}
            </ul>
          )}
        </div>
        {f.unexpectedFeedback.length > 0 && (
          <div className="mt-4 card border-indigo-400/20 p-5">
            <p className="mb-2 text-sm font-semibold text-chalk-100">Unexpected feedback (replies that didn’t fit the model)</p>
            <ul className="space-y-1.5">
              {f.unexpectedFeedback.map((u, i) => <li key={i} className="text-xs text-chalk-400">{u}</li>)}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

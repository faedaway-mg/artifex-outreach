// Phase 1 — Launch Intelligence Dashboard. Measures learning, execution, and
// business outcomes across Acquisition, Outreach, Discovery, Commercial, and
// Intelligence Quality. Untracked metrics render as "—", never invented.
import { launchMetrics } from "@/lib/launch/metrics";
import { metric } from "@/lib/launch/types";
import { MetricStat, Breakdown, PendingList } from "@/components/launch/LaunchUI";
import { SectionHeader } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const money = (n: number | null) => (n == null ? "—" : formatCurrency(n));

export default async function LaunchDashboardPage() {
  const m = await launchMetrics();
  const a = m.acquisition, o = m.outreach, d = m.discovery, c = m.commercial, iq = m.intelligenceQuality;

  return (
    <div className="space-y-10">
      {/* ── Acquisition ─────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Acquisition" subtitle="Discovery, analysis, qualification, and the intelligence behind it." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Businesses discovered", a.discovered)} />
          <MetricStat metric={metric("Analyzed", a.analyzed)} tone="azure" />
          <MetricStat metric={metric("Approved", a.approved)} tone="teal" />
          <MetricStat metric={metric("Rejected", a.rejected)} tone="amber" />
          <MetricStat metric={metric("Avg improvement potential", a.avgImprovementPotential == null ? null : `${a.avgImprovementPotential}/100`, a.avgImprovementPotential != null)} tone="indigo" />
          <MetricStat metric={metric("Avg technology maturity", a.avgTechnologyMaturity == null ? null : `${a.avgTechnologyMaturity}/5`, a.avgTechnologyMaturity != null)} />
          <MetricStat metric={metric("Avg evidence confidence", a.avgEvidenceConfidence == null ? null : `${a.avgEvidenceConfidence}/100`, a.avgEvidenceConfidence != null)} />
          <MetricStat metric={metric("Avg enrichment time", a.avgEnrichmentSeconds == null ? null : `${a.avgEnrichmentSeconds}s`, a.avgEnrichmentSeconds != null, "avg prospecting-run duration")} />
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-3">
          <Breakdown title="Lead source distribution" data={a.leadSourceDistribution} />
          <Breakdown title="Provider contribution (%)" data={a.providerContribution} empty="No analyzed businesses persisted yet." />
          <Breakdown title="Rejection reasons" data={a.rejectionReasons} empty="No rejections yet." />
        </div>
      </section>

      {/* ── Outreach ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Outreach" subtitle="Preparation, sending, engagement, and replies." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Prepared", o.prepared)} />
          <MetricStat metric={metric("Approved", o.approved)} tone="teal" />
          <MetricStat metric={metric("Sent", o.sent)} tone="azure" />
          <MetricStat metric={metric("Snapshots sent", o.snapshotsSent)} />
          <MetricStat metric={metric("Videos sent", o.videosSent)} tone="indigo" />
          <MetricStat metric={metric("Email opens", o.emailOpens)} />
          <MetricStat metric={metric("Snapshot views", o.snapshotViews, true, "concept-preview views")} />
          <MetricStat metric={metric("Video views", o.videoViews, false)} />
          <MetricStat metric={metric("Positive replies", o.positiveReplies)} tone="emerald" />
          <MetricStat metric={metric("Neutral replies", o.neutralReplies)} />
          <MetricStat metric={metric("Negative replies", o.negativeReplies)} tone="amber" />
          <MetricStat metric={metric("No response", o.noResponse)} />
          <MetricStat metric={metric("Bounces", o.bounces)} tone="amber" />
          <MetricStat metric={metric("Suppressions", o.suppressions)} />
          <MetricStat metric={metric("Unsubscribes", o.unsubscribes)} tone="amber" />
          <MetricStat metric={metric("Follow-up completion", `${o.followUpCompletion}%`)} />
          <MetricStat metric={metric("Avg response time", o.avgResponseMinutes == null ? null : `${o.avgResponseMinutes} min`, o.avgResponseMinutes != null)} />
        </div>
      </section>

      {/* ── Discovery ───────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Discovery" subtitle="Conversations that confirm the intelligence." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Calls booked", d.callsBooked)} tone="azure" />
          <MetricStat metric={metric("Calls completed", d.callsCompleted)} tone="teal" />
          <MetricStat metric={metric("Avg call duration", d.avgCallDurationMinutes, false)} />
          <MetricStat metric={metric("Confirmed friction points", d.confirmedFrictionPoints, false)} />
          <MetricStat metric={metric("Avg confirmed opportunities", d.avgConfirmedOpportunities, false)} />
          <MetricStat metric={metric("Avg confidence increase", d.avgDiscoveryConfidenceIncrease, false)} />
          <MetricStat metric={metric("Evolution plans created", d.evolutionPlansCreated)} tone="indigo" />
          <MetricStat metric={metric("Operator notes completed", d.operatorNotesCompleted)} />
        </div>
      </section>

      {/* ── Commercial ──────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Commercial" subtitle="Proposals, contracts, revenue, and projected relationship value." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricStat metric={metric("Focused Improvements", c.focusedImprovements, true, "recommended as entry")} />
          <MetricStat metric={metric("Phased Modernizations", c.phasedModernizations, true, "recommended as entry")} />
          <MetricStat metric={metric("Technology Partnerships", c.technologyPartnerships, true, "recommended as entry")} />
          <MetricStat metric={metric("Proposals delivered", c.proposalsDelivered)} />
          <MetricStat metric={metric("Contracts signed", c.contractsSigned)} tone="emerald" />
          <MetricStat metric={metric("Revenue won", money(c.revenueWon))} tone="emerald" />
          <MetricStat metric={metric("Monthly recurring revenue", c.monthlyRecurringRevenue, false)} />
          <MetricStat metric={metric("Avg first engagement", money(c.avgFirstEngagementValue), c.avgFirstEngagementValue != null, "projected")} />
          <MetricStat metric={metric("Avg relationship value", money(c.avgProjectedRelationshipValue), c.avgProjectedRelationshipValue != null, "12-mo, confidence-adjusted")} tone="indigo" />
          <MetricStat metric={metric("Expansion opportunities", c.expansionOpportunities)} tone="teal" />
        </div>
      </section>

      {/* ── Intelligence Quality ────────────────────────────────────── */}
      <section>
        <SectionHeader title="Intelligence Quality" subtitle="Is the Business Intelligence Engine actually accurate — and improving?" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Breakdown title="Most common friction categories" data={iq.mostCommonFriction} empty="No analyzed businesses persisted yet." />
          <Breakdown title="Most common opportunity categories" data={iq.mostCommonOpportunities} empty="No analyzed businesses persisted yet." />
        </div>
        <div className="mt-4 card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/[0.06] text-left text-xs text-chalk-500">
              <tr>
                <th className="px-4 py-3 font-medium">Industry group</th>
                <th className="px-3 py-3 text-right font-medium">Contacted</th>
                <th className="px-3 py-3 text-right font-medium">Replies</th>
                <th className="px-3 py-3 text-right font-medium">Meetings</th>
                <th className="px-4 py-3 text-right font-medium">Won</th>
              </tr>
            </thead>
            <tbody>
              {iq.industryPerformance.map((r) => (
                <tr key={r.group} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3">
                    <p className="text-chalk-100">{r.group}</p>
                    {!r.sufficient && <p className="text-[10px] text-amber-300/70">Early data — insufficient sample</p>}
                  </td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.contacted}</td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.sufficient ? r.replies : "—"}</td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.meetings}</td>
                  <td className="px-4 py-3 text-right text-teal-300">{r.won}</td>
                </tr>
              ))}
              {iq.industryPerformance.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-chalk-600">No industry data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <PendingList title="Accuracy & learning metrics — instrumentation pending" items={iq.instrumentationPending} />
        </div>
      </section>
    </div>
  );
}

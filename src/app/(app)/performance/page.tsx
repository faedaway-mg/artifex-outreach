import {
  listLeads,
  allMeetings,
  allProposals,
  allOutreach,
  allVideos,
  allDeliverables,
  allPlans,
  listSuppressions,
  allFeedback,
  listAudit,
  allEmailSends,
} from "@/lib/repo";
import { Stat } from "@/components/ui";
import { categoryPerformance, MIN_SAMPLE } from "@/lib/analytics";
import { acquisitionMetrics } from "@/lib/acquisition/analytics";
import { channelFunnel } from "@/lib/outreach/channel-funnel";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

export default async function PerformancePage() {
  const [leads, meetings, proposals, outreach, videos, deliverables, plans, suppressions, feedback, audit, emailSends] = await Promise.all([
    listLeads(),
    allMeetings(),
    allProposals(),
    allOutreach(),
    allVideos(),
    allDeliverables(),
    allPlans(),
    listSuppressions(),
    allFeedback(),
    listAudit(2000),
    allEmailSends(),
  ]);
  // Channel comparison — value-first email → warm follow-up vs cold call, from existing sources.
  const funnel = channelFunnel({ audit, emailSends, outreach, meetings });
  const acq = acquisitionMetrics(leads, plans, meetings, proposals, suppressions, feedback);

  const discovered = leads.length;
  const qualified = leads.filter((l) => l.leadScore != null).length;
  const tierA = leads.filter((l) => l.tier === "A").length;
  const reportsGenerated = deliverables.length;
  const reportsApproved = deliverables.filter((d) => d.status !== "draft").length;
  const videosPrepared = videos.length;
  const sent = outreach.filter((o) => o.status === "sent").length;
  const replies = outreach.filter((o) => o.responseStatus === "replied").length;
  const meetingsBooked = meetings.length;
  const proposalsSent = proposals.filter((p) => p.status !== "draft").length;
  const won = leads.filter((l) => l.pipelineStage === "Won").length;
  const revenue = proposals.filter((p) => p.status === "accepted").reduce((s, p) => s + (p.amount ?? 0), 0);
  const avgValue = won ? Math.round(revenue / won) : 0;

  // Source / action performance + category-group performance
  const bySource = groupCount(leads.map((l) => l.source));
  const byAction = groupCount(leads.map((l) => l.recommendedAction ?? "Unset"));
  const catPerf = categoryPerformance(leads, outreach, meetings, proposals);

  return (
    <div className="space-y-8">
      <div>
        <p className="label">Insights</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">What we're learning</h1>
        <p className="mt-1 text-sm text-chalk-400">Understanding, relationships, and outcomes — not vanity metrics.</p>
      </div>

      {/* Understanding & engagement funnel */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Businesses discovered" value={discovered} />
        <Stat label="Understood" value={qualified} tone="azure" />
        <Stat label="Priority businesses" value={tierA} tone="amber" />
        <Stat label="Snapshots prepared" value={reportsGenerated} />
        <Stat label="Snapshots shared" value={reportsApproved} />
        <Stat label="Walkthroughs prepared" value={videosPrepared} tone="indigo" />
        <Stat label="Outreach sent" value={sent} />
        <Stat label="Replies received" value={replies} tone="emerald" />
        <Stat label="Discovery conversations" value={meetingsBooked} tone="amber" />
        <Stat label="Evolution plans shared" value={proposalsSent} />
        <Stat label="Partnerships formed" value={won} tone="emerald" />
        <Stat label="Revenue won" value={formatCurrency(revenue)} tone="emerald" />
      </div>

      {/* Channel comparison — which path creates pipeline per minute of attention */}
      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-chalk-400">Channel comparison</h2>
        <p className="mb-3 text-[12px] text-chalk-500">Value-first email → warm follow-up vs cold calling. Warm = a call placed after the business was already emailed.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Emails sent" value={funnel.email.sent} tone="indigo" hint={`${funnel.email.businessesEmailed} businesses`} />
          <Stat label="Email replies" value={funnel.email.replies} tone="emerald" hint={pct(funnel.email.replies, funnel.email.sent)} />
          <Stat label="Warm calls" value={funnel.warmCalls.attempted} tone="teal" hint={`${funnel.warmCalls.answered} answered`} />
          <Stat label="Warm call answer rate" value={pct(funnel.warmCalls.answered, funnel.warmCalls.attempted)} tone="teal" />
          <Stat label="Cold calls" value={funnel.coldCalls.attempted} hint={`${funnel.coldCalls.answered} answered`} />
          <Stat label="Cold call answer rate" value={pct(funnel.coldCalls.answered, funnel.coldCalls.attempted)} />
          <Stat label="Cold call → email" value={funnel.coldCalls.emailCaptured} hint={pct(funnel.coldCalls.emailCaptured, funnel.coldCalls.attempted)} />
          <Stat label="Conversations" value={funnel.conversations} tone="amber" />
        </div>
      </section>

      {/* Progression rates */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-chalk-400">Progression</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Contact → reply" value={pct(replies, sent)} hint={`${replies}/${sent}`} />
          <Stat label="Reply → conversation" value={pct(meetingsBooked, replies || 1)} hint={`${meetingsBooked}/${replies}`} />
          <Stat label="Conversation → plan" value={pct(proposalsSent, meetingsBooked || 1)} hint={`${proposalsSent}/${meetingsBooked}`} />
          <Stat label="Plan → partnership" value={pct(won, proposalsSent || 1)} hint={`${won}/${proposalsSent}`} />
          <Stat label="Avg first engagement" value={formatCurrency(avgValue)} />
        </div>
      </section>

      {/* Recommendations & readiness */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-chalk-400">Recommendations &amp; readiness</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Plans prepared" value={acq.totalPlans} />
          <Stat label="Recommendation confidence" value={acq.totalPlans ? `${acq.approvalRate}%` : "—"} hint={`${acq.approvedPlans} confirmed / ${acq.rejectedPlans} declined`} tone="teal" />
          <Stat label="Avg time to confirm" value={acq.avgTimeToApprovalHours != null ? `${acq.avgTimeToApprovalHours}h` : "—"} />
          <Stat label="Operator adjustments" value={acq.overrides} tone="amber" />
          <Stat label="Avg opportunity value" value={formatCurrency(acq.avgEstValue)} />
          <Stat label="Suppression rate" value={`${acq.suppressionRate}%`} />
          <Stat label="Manual review" value={acq.manualReview} />
          <Stat label="Assisted" value={acq.assisted} tone="indigo" />
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <Breakdown title="Engagement approach distribution" data={acq.strategyDistribution} />
          <Breakdown title="Preparation cost by approach ($)" data={acq.assetCostByStrategy.map(([k, v]) => [k, Math.round(v * 100)] as [string, number])} />
        </div>
        {acq.approvedPlans < MIN_SAMPLE && <p className="mt-2 text-[11px] text-amber-300/70">Early data — insufficient sample for reliable conclusions (&lt;{MIN_SAMPLE} confirmed recommendations). Targeting changes always require your confirmation.</p>}
      </section>

      {/* Performance by category group */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-chalk-400">By industry</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-white/[0.06] text-left text-xs text-chalk-500">
              <tr>
                <th className="px-4 py-3 font-medium">Industry</th>
                <th className="px-3 py-3 text-right font-medium">Discovered</th>
                <th className="px-3 py-3 text-right font-medium">Understood</th>
                <th className="px-3 py-3 text-right font-medium">Contacted</th>
                <th className="px-3 py-3 text-right font-medium">Replies</th>
                <th className="px-3 py-3 text-right font-medium">Conversations</th>
                <th className="px-3 py-3 text-right font-medium">Plans</th>
                <th className="px-3 py-3 text-right font-medium">Partnerships</th>
                <th className="px-4 py-3 text-right font-medium">Relationship value</th>
              </tr>
            </thead>
            <tbody>
              {catPerf.map((r) => (
                <tr key={r.group} className="border-b border-white/[0.04] last:border-0">
                  <td className="px-4 py-3">
                    <p className="text-chalk-100">{r.group}</p>
                    {!r.sufficient && <p className="text-[10px] text-amber-300/70">Early data — insufficient sample (&lt;{MIN_SAMPLE} contacted)</p>}
                  </td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.discovered}</td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.qualified}</td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.contacted}</td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.sufficient ? r.replies : "—"}</td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.meetings}</td>
                  <td className="px-3 py-3 text-right text-chalk-300">{r.proposals}</td>
                  <td className="px-3 py-3 text-right text-teal-300">{r.won}</td>
                  <td className="px-4 py-3 text-right text-chalk-300">{formatCurrency(Math.round(r.pipelineValue))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-chalk-600">Rates are shown as conclusions only once an industry has ≥ {MIN_SAMPLE} contacted businesses. Targeting changes always require your confirmation.</p>
      </section>

      {/* Breakdowns */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="Where businesses come from" data={bySource} />
        <Breakdown title="Recommended next-step mix" data={byAction} />
      </div>
    </div>
  );
}

function groupCount(values: string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function Breakdown({ title, data }: { title: string; data: [string, number][] }) {
  const max = Math.max(1, ...data.map(([, n]) => n));
  return (
    <div className="card p-5">
      <h3 className="mb-3 text-sm font-semibold text-chalk-100">{title}</h3>
      <div className="space-y-2.5">
        {data.map(([label, n]) => (
          <div key={label}>
            <div className="flex justify-between text-xs">
              <span className="text-chalk-400">{label}</span>
              <span className="font-mono text-chalk-300">{n}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-azure-500 to-indigo-500" style={{ width: `${(n / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

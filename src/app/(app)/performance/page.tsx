import {
  listLeads,
  allMeetings,
  allProposals,
  allOutreach,
  allVideos,
  allDeliverables,
} from "@/lib/repo";
import { Stat } from "@/components/ui";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

export default async function PerformancePage() {
  const [leads, meetings, proposals, outreach, videos, deliverables] = await Promise.all([
    listLeads(),
    allMeetings(),
    allProposals(),
    allOutreach(),
    allVideos(),
    allDeliverables(),
  ]);

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

  // Source / industry / action performance
  const bySource = groupCount(leads.map((l) => l.source));
  const byIndustry = groupCount(leads.map((l) => l.industry));
  const byAction = groupCount(leads.map((l) => l.recommendedAction ?? "Unset"));

  return (
    <div className="space-y-8">
      <div>
        <p className="label">Performance</p>
        <h1 className="mt-1 text-2xl font-semibold text-chalk-50">Results that matter</h1>
        <p className="mt-1 text-sm text-chalk-400">Qualified conversations and revenue — not vanity metrics.</p>
      </div>

      {/* Funnel */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Leads discovered" value={discovered} />
        <Stat label="Qualified" value={qualified} tone="azure" />
        <Stat label="Tier A leads" value={tierA} tone="amber" />
        <Stat label="Reports generated" value={reportsGenerated} />
        <Stat label="Reports approved" value={reportsApproved} />
        <Stat label="Videos prepared" value={videosPrepared} tone="indigo" />
        <Stat label="Outreach sent" value={sent} />
        <Stat label="Replies received" value={replies} tone="emerald" />
        <Stat label="Meetings booked" value={meetingsBooked} tone="amber" />
        <Stat label="Proposals sent" value={proposalsSent} />
        <Stat label="Deals won" value={won} tone="emerald" />
        <Stat label="Revenue won" value={formatCurrency(revenue)} tone="emerald" />
      </div>

      {/* Conversion rates */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-chalk-400">Conversion</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Lead → reply" value={pct(replies, sent)} hint={`${replies}/${sent}`} />
          <Stat label="Reply → meeting" value={pct(meetingsBooked, replies || 1)} hint={`${meetingsBooked}/${replies}`} />
          <Stat label="Meeting → proposal" value={pct(proposalsSent, meetingsBooked || 1)} hint={`${proposalsSent}/${meetingsBooked}`} />
          <Stat label="Proposal → close" value={pct(won, proposalsSent || 1)} hint={`${won}/${proposalsSent}`} />
          <Stat label="Avg project value" value={formatCurrency(avgValue)} />
        </div>
      </section>

      {/* Breakdowns */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Breakdown title="Source performance" data={bySource} />
        <Breakdown title="Industry performance" data={byIndustry} />
        <Breakdown title="Recommended-action mix" data={byAction} />
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

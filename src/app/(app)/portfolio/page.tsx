// Portfolio — the founder's executive view across every engaged business. Composed
// from the same deterministic engines, one row per business, plus the consulting
// patterns learned across engagements. Bounded to businesses that actually have an
// engagement (memory, roadmap movement, or a review) so it stays meaningful and fast.
import { LayoutGrid } from "lucide-react";
import {
  listLeads, allRelationshipMemory, allRoadmapProgress, allOutcomeReviews,
  meetingsForLead, proposalsForLead,
} from "@/lib/repo";
import { assembleEngagementContext, buildPortfolioRow } from "@/lib/engagement";
import { buildKnowledgeGraph } from "@/lib/outcomes";
import { PortfolioView } from "@/components/PortfolioView";

export const dynamic = "force-dynamic";

function groupBy<T extends { leadId: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { if (!m.has(r.leadId)) m.set(r.leadId, []); m.get(r.leadId)!.push(r); }
  return m;
}

export default async function PortfolioPage() {
  const [leads, memory, progress, reviews] = await Promise.all([
    listLeads(), allRelationshipMemory(), allRoadmapProgress(), allOutcomeReviews(),
  ]);
  const memByLead = groupBy(memory);
  const progByLead = groupBy(progress);
  const revByLead = groupBy(reviews);

  // Engaged = has memory, roadmap movement, or a review.
  const engagedIds = new Set<string>([...memByLead.keys(), ...progByLead.keys(), ...revByLead.keys()]);
  const engaged = leads.filter((l) => engagedIds.has(l.id));

  const now = Date.now();
  const rows = await Promise.all(
    engaged.map(async (lead) => {
      const [meetings, proposals] = await Promise.all([meetingsForLead(lead.id), proposalsForLead(lead.id)]);
      const ctx = assembleEngagementContext({
        lead,
        memory: memByLead.get(lead.id) ?? [],
        meetings, proposals, plans: [],
        progress: progByLead.get(lead.id) ?? [],
        reviews: revByLead.get(lead.id) ?? [],
        outreach: [], inbound: [], snapshots: [],
        now,
      });
      return buildPortfolioRow(ctx);
    }),
  );

  // Sort: at-risk first, then awaiting reviews, then recent wins.
  rows.sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || b.awaitingReviews - a.awaitingReviews || Number(b.recentWin) - Number(a.recentWin));

  const patterns = buildKnowledgeGraph(reviews);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <LayoutGrid size={18} className="text-azure-300" />
        <h1 className="text-lg font-semibold text-chalk-50">Portfolio</h1>
        <span className="text-[12px] text-chalk-500">· every engagement, at a glance</span>
      </div>
      <PortfolioView rows={rows} patterns={patterns} />
    </div>
  );
}

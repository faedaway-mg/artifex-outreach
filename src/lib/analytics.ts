// Category analytics: concentration, Today mix, per-category performance (with
// honest small-sample guards) and non-blocking advisories + learning suggestions.
import type { Lead, Outreach, Meeting, Proposal, ProspectingProfile } from "./types";

const MIN_SAMPLE = 10; // contacted prospects before "strong" conclusions

export function groupOf(lead: Lead): string {
  return lead.categoryGroup ?? "Other";
}

export function todayMix(leads: Lead[], todayLeadIds: Set<string>): { group: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const l of leads) if (todayLeadIds.has(l.id)) counts[groupOf(l)] = (counts[groupOf(l)] ?? 0) + 1;
  return Object.entries(counts).map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count);
}

export function concentrationAdvisories(leads: Lead[], profile: ProspectingProfile): string[] {
  const out: string[] = [];
  const total = leads.length;
  if (total < 3) return out;
  const byGroup: Record<string, number> = {};
  for (const l of leads) byGroup[groupOf(l)] = (byGroup[groupOf(l)] ?? 0) + 1;
  const top = Object.entries(byGroup).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] / total >= 0.4) {
    out.push(`${Math.round((top[1] / total) * 100)}% of the current pipeline is ${top[0]}. Tomorrow's search will emphasize underrepresented groups.`);
  }
  // High-priority groups that are underrepresented
  const highGroups = new Set((profile.categories ?? []).filter((c) => c.enabled && c.priority === "high").map((c) => c.group));
  for (const g of highGroups) {
    const share = (byGroup[g] ?? 0) / total;
    if (share < 0.05) out.push(`${g} is underrepresented despite being a high-priority group.`);
  }
  // Not searched in a while
  const stale = (profile.categories ?? []).filter((c) => c.enabled && c.lastSearchedAt && Date.now() - +new Date(c.lastSearchedAt) > 7 * 86_400_000);
  const staleGroups = Array.from(new Set(stale.map((c) => c.group)));
  if (staleGroups.length) out.push(`${staleGroups.slice(0, 2).join(" and ")} not searched in over a week.`);
  return out.slice(0, 3);
}

export interface CategoryPerfRow {
  group: string;
  discovered: number;
  qualified: number;
  contacted: number;
  replies: number;
  meetings: number;
  proposals: number;
  won: number;
  revenue: number;
  pipelineValue: number;
  sufficient: boolean;
}

export function categoryPerformance(leads: Lead[], outreach: Outreach[], meetings: Meeting[], proposals: Proposal[]): CategoryPerfRow[] {
  const leadGroup = new Map(leads.map((l) => [l.id, groupOf(l)]));
  const rows: Record<string, CategoryPerfRow> = {};
  const row = (g: string) =>
    (rows[g] ??= { group: g, discovered: 0, qualified: 0, contacted: 0, replies: 0, meetings: 0, proposals: 0, won: 0, revenue: 0, pipelineValue: 0, sufficient: false });

  const CLOSED = new Set(["Won", "Lost", "Disqualified", "Nurture"]);
  for (const l of leads) {
    const r = row(groupOf(l));
    r.discovered += 1;
    if (l.leadScore != null) r.qualified += 1;
    if (l.pipelineStage === "Won") r.won += 1;
    if (!CLOSED.has(l.pipelineStage) && l.estimatedValueLow && l.estimatedValueHigh) r.pipelineValue += (l.estimatedValueLow + l.estimatedValueHigh) / 2;
  }
  for (const o of outreach) {
    const g = leadGroup.get(o.leadId);
    if (!g) continue;
    if (o.status === "sent") row(g).contacted += 1;
    if (o.responseStatus === "replied") row(g).replies += 1;
  }
  for (const m of meetings) { const g = leadGroup.get(m.leadId); if (g) row(g).meetings += 1; }
  for (const p of proposals) {
    const g = leadGroup.get(p.leadId);
    if (!g) continue;
    if (p.status !== "draft") row(g).proposals += 1;
    if (p.status === "accepted") row(g).revenue += p.amount ?? 0;
  }
  return Object.values(rows)
    .map((r) => ({ ...r, sufficient: r.contacted >= MIN_SAMPLE }))
    .sort((a, b) => b.discovered - a.discovered);
}

export { MIN_SAMPLE };

// ─────────────────────────────────────────────────────────────────────────────
// Search Enrichment Provider (Phase 4).
//
// Gathers publicly available business momentum signals (expansion, awards, news,
// hiring, new locations, new services, partnerships, announcements) and turns them
// into growth-signal Evidence. Live search is config-gated; the analyzer is a pure
// function over supplied search/news items and is fully testable offline.
// ─────────────────────────────────────────────────────────────────────────────
import { evidence, type Evidence, type ProviderResult } from "../evidence";
import type { EnrichmentProvider, EnrichmentInput, SuppliedSearchItem } from "../providers";

const PROVIDER_ID = "search-enrichment";

interface SignalDef {
  key: string;
  label: string;
  re: RegExp;
}

const SIGNALS: SignalDef[] = [
  { key: "expansion", label: "Expansion", re: /expand|expansion|new (location|office|branch|store)|opening (a|its|another)|now open in/i },
  { key: "award", label: "Award / recognition", re: /award|voted best|top \d+|recognized|named (a|the)|winner/i },
  { key: "hiring", label: "Hiring / team growth", re: /hiring|we'?re growing|join our team|new (hire|role|position)|adding staff/i },
  { key: "newService", label: "New service / offering", re: /new (service|offering|product|line)|now offering|introduc(e|ing)|launch(ed|ing)?/i },
  { key: "partnership", label: "Partnership", re: /partner(ship|ed)? with|collaborat|joins forces|teams up/i },
  { key: "funding", label: "Funding / investment", re: /raised|funding|investment|acqui(red|sition)|series [a-d]/i },
  { key: "community", label: "Community involvement", re: /sponsor|charity|community|fundrais|donat|volunteer/i },
  { key: "press", label: "Press / interview", re: /interview|featured in|as seen|press release|podcast/i },
];

/** PURE: extract growth/momentum signals from public items into Evidence. */
export function extractGrowthSignals(items: SuppliedSearchItem[], businessName: string): Evidence[] {
  if (!items.length) return [];
  const out: Evidence[] = [];
  const seen = new Set<string>();
  for (const sig of SIGNALS) {
    const hit = items.find((it) => sig.re.test(`${it.title} ${it.snippet ?? ""}`));
    if (!hit || seen.has(sig.key)) continue;
    seen.add(sig.key);
    out.push(
      evidence({
        id: `${PROVIDER_ID}:${sig.key}`,
        providerId: PROVIDER_ID,
        kind: "activity",
        field: `growth:${sig.key}`,
        value: hit.title,
        statement: `${sig.label} signal for ${businessName}: "${hit.title.slice(0, 140)}". Public momentum worth noting — validate relevance in conversation.`,
        observationType: "Strong inference",
        confidence: hit.url ? "Likely" : "Unknown",
        sourceUrl: hit.url ?? null,
      }),
    );
  }
  return out;
}

export const searchEnrichmentProvider: EnrichmentProvider = {
  id: PROVIDER_ID,
  name: "Search Enrichment",
  capability: { fields: ["growth:expansion", "growth:award", "growth:hiring", "growth:newService", "growth:partnership"], external: true, costUsd: 0 },
  ready: () => true, // offline via supplied items; live search gated by config
  async enrich(input: EnrichmentInput): Promise<ProviderResult> {
    if (!input.searchItems?.length) return { providerId: PROVIDER_ID, ok: true, evidence: [], notes: ["no search items supplied"], costUsd: 0 };
    return { providerId: PROVIDER_ID, ok: true, evidence: extractGrowthSignals(input.searchItems, input.lead.businessName), notes: [`scanned ${input.searchItems.length} items`], costUsd: 0 };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TARGETING BOARD (mandate 27). Server-side read-only assembly of the operator's Targeting view: the next
// markets discovery is searching + why, the qualified backlog counts, and a scored/explained card per lead —
// all from CANONICAL data (leads + business intelligence + contacts) run through the pure scoring engine.
// It NEVER mutates, sends, approves, or schedules.
// ─────────────────────────────────────────────────────────────────────────────
import { listLeads, getBusinessIntelligence, contactsForLead } from "../repo";
import { isRejectedLead } from "../outreach/rejection-core";
import { marketTierOf } from "../geo-market";
import { selectTargetMarkets, DEFAULT_MARKET_POLICY, EXCLUDED_MAJOR_MARKETS, type MarketTierSize } from "../market-policy";
import { buildTargetingInput, backlogCounts, exclusionsByReason, type AdapterFinding } from "./adapter";
import { scoreTarget, type TargetingScore } from "./scoring";
import { routeAsset, explainTarget, type AssetRouting, type WhyThisBusiness } from "./prepare";

export interface TargetingCard {
  leadId: string;
  businessName: string;
  city: string;
  state: string;
  band: TargetingScore["band"];
  total: number;
  marketTier: string;
  recommendedAsset: string;
  requiresApproval: boolean;
  recipientRole: string;
  recipientVerified: boolean;
  why: WhyThisBusiness;
  score: TargetingScore;
  asset: AssetRouting;
}

export interface TargetingBoard {
  version: string;
  nextMarkets: Array<{ city: string; state: string; tier: MarketTierSize; region: string; reason: string }>;
  excludedMajorCount: number;
  populationSource: string;
  counts: ReturnType<typeof backlogCounts>;
  exclusions: Record<string, number>;
  cards: TargetingCard[]; // ranked, highest score first
}

// Map geo-market tier → targeting market tier.
function tierOf(city: string | null, state: string | null): MarketTierSize {
  const t = marketTierOf({ city: city ?? "", state: state ?? "" } as any);
  return t === "primary" ? "primary" : t === "regional" ? "tertiary" : "secondary";
}

export async function buildTargetingBoard(opts: { limit?: number } = {}): Promise<TargetingBoard> {
  const leads = await listLeads();
  const cards: TargetingCard[] = [];
  const scores: TargetingScore[] = [];

  for (const lead of leads) {
    const bi = await getBusinessIntelligence(lead.id).catch(() => null);
    const profile = (bi?.profile as any)?.businessProfile ?? null;
    if (!profile) continue; // only businesses with real evidence are scored
    const opportunities: any[] = Array.isArray(profile.opportunities) ? profile.opportunities : [];
    const findings: AdapterFinding[] = opportunities.slice(0, 5).map((o) => ({
      id: String(o.id), observation: String(o.observation ?? ""), whyItMatters: o.whyItMatters ?? null,
      confidenceScore: typeof o.confidence?.score === "number" ? o.confidence.score : 0.6, sourceUrl: (o.basis?.[0] ?? null),
    }));
    const contacts = await contactsForLead(lead.id).catch(() => []);
    const c = contacts.find((x: any) => x.email && !x.optedOut) ?? null;
    const confScore = (v: any): number => typeof v === "number" ? v : typeof v?.score === "number" ? v.score : ({ Verified: 0.9, Likely: 0.6, Observed: 0.9, Reported: 0.7, Inferred: 0.4, Unknown: 0.3 } as Record<string, number>)[String(v)] ?? 0.4;
    const contact = c ? { role: (c as any).title, email: c.email, verified: !!(c as any).verified, confidenceScore: confScore((c as any).confidence), locallyControlled: true, source: (c as any).source } : null;

    const input = buildTargetingInput({
      lead: { id: lead.id, businessName: lead.businessName, city: lead.city, state: lead.state, website: lead.website, reviewCount: lead.reviewCount, rating: lead.rating, locationsCount: lead.locationsCount, industry: lead.industry, pipelineStage: lead.pipelineStage },
      findings,
      contact,
      flags: {
        isRejected: isRejectedLead(lead), isSuppressed: false, isDuplicate: false,
        marketTier: tierOf(lead.city, lead.state),
      },
    });
    const score = scoreTarget(input);
    const asset = routeAsset(score, { videoCapacityAvailable: true });
    const why = explainTarget(input, score, asset, `${input.city}, ${input.state} — ${input.marketTier} market`);
    scores.push(score);
    cards.push({
      leadId: lead.id, businessName: lead.businessName, city: input.city, state: input.state,
      band: score.band, total: score.total, marketTier: input.marketTier,
      recommendedAsset: asset.asset, requiresApproval: asset.requiresApproval,
      recipientRole: input.recipient.role, recipientVerified: input.recipient.verified,
      why, score, asset,
    });
  }

  cards.sort((a, b) => b.total - a.total);
  const next = selectTargetMarkets({ cursor: leads.length, count: 6 });
  return {
    version: DEFAULT_MARKET_POLICY.version,
    nextMarkets: next.map((s) => ({ city: s.market.city, state: s.market.state, tier: s.tier, region: s.market.region, reason: s.reasons[0] })),
    excludedMajorCount: EXCLUDED_MAJOR_MARKETS.length,
    populationSource: DEFAULT_MARKET_POLICY.popSource,
    counts: backlogCounts(scores),
    exclusions: exclusionsByReason(scores),
    cards: opts.limit ? cards.slice(0, opts.limit) : cards,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT BACKLOG (mandate 28). Server-side: which businesses are READY_FOR_NARRATION, in sprint order, with
// everything the one-company sprint screen needs (name, market, score/why, recipient, narration + revision +
// content hash, word count, duration). Reuses the M27 targeting engine + M28 eligibility gate + the canonical
// narration template. Read-only; NEVER prepares/approves/schedules/sends.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { listLeads, getBusinessIntelligence, contactsForLead } from "../repo";
import { isRejectedLead } from "../outreach/rejection-core";
import { loadTemplate } from "../content-studio/store";
import { marketTierOf } from "../geo-market";
import type { MarketTierSize } from "../market-policy";
import { buildTargetingInput, type AdapterFinding } from "../targeting/adapter";
import { scoreTarget, mayAutoPrepare } from "../targeting/scoring";
import { explainTarget, routeAsset } from "../targeting/prepare";
import { narrationReadiness } from "./eligibility";
import { orderForSprint, type SprintRankable } from "./session";
import { dispositionMap } from "../targeting/disposition";

export interface SprintCard {
  leadId: string;
  businessName: string;
  market: string;
  band: string;
  score: number;
  whyShort: string;               // concise "why this business"
  recipientRole: string;
  recipientVerified: boolean;
  narration: string;              // the EXACT current narration to copy
  scriptRevisionId: string;       // immutable revision id the copy/upload binds to
  narrationHash: string;          // content hash of the narration (copy-binding integrity)
  inputVersion: string;
  wordCount: number;
  estimatedSeconds: number;
}

const tierOf = (city: string | null, state: string | null): MarketTierSize => {
  const t = marketTierOf({ city: city ?? "", state: state ?? "" } as any);
  return t === "primary" ? "primary" : t === "regional" ? "tertiary" : "secondary";
};
const words = (s: string) => (s.trim().match(/[A-Za-z0-9']+/g) ?? []).length;
const confScore = (v: any): number => typeof v === "number" ? v : typeof v?.score === "number" ? v.score : ({ Verified: 0.9, Likely: 0.6, Observed: 0.9, Reported: 0.7, Inferred: 0.4, Unknown: 0.3 } as Record<string, number>)[String(v)] ?? 0.4;

export interface SprintBacklog {
  readyLeadIds: string[];         // in sprint order
  cards: Record<string, SprintCard>;
  readyCount: number;
}

/** Build the ordered READY_FOR_NARRATION backlog. `nowMs` is injected for deterministic freshness ranking. */
export async function buildSprintBacklog(opts: { nowMs?: number } = {}): Promise<SprintBacklog> {
  const now = opts.nowMs ?? 0;
  const leads = await listLeads();
  const disposed = await dispositionMap().catch(() => ({} as Record<string, any>));
  const cards: Record<string, SprintCard> = {};
  const rankables: SprintRankable[] = [];

  for (const lead of leads) {
    if (disposed[lead.id]) continue; // DO_NOT_PREPARE / INTERNAL_TEST leads never enter the sprint
    const bi = await getBusinessIntelligence(lead.id).catch(() => null);
    const profile = (bi?.profile as any)?.businessProfile ?? null;
    if (!profile) continue;
    const template = await loadTemplate(`client-${lead.id}`).catch(() => null);
    if (!template || !(template.narration ?? []).length) continue; // no narration → not narration-ready
    const narration = (template.narration ?? []).join(" ");

    const opportunities: any[] = Array.isArray(profile.opportunities) ? profile.opportunities : [];
    const findings: AdapterFinding[] = opportunities.slice(0, 5).map((o) => ({
      id: String(o.id), observation: String(o.observation ?? ""), whyItMatters: o.whyItMatters ?? null,
      confidenceScore: confScore(o.confidence), sourceUrl: (o.basis?.[0] ?? null),
    }));
    const contacts = await contactsForLead(lead.id).catch(() => []);
    const c = contacts.find((x: any) => x.email && !x.optedOut) ?? null;
    const contact = c ? { role: (c as any).title, email: c.email, verified: !!(c as any).verified, confidenceScore: confScore((c as any).confidence), locallyControlled: true } : null;

    const input = buildTargetingInput({
      lead: { id: lead.id, businessName: lead.businessName, city: lead.city, state: lead.state, website: lead.website, reviewCount: lead.reviewCount, rating: lead.rating, locationsCount: lead.locationsCount, industry: lead.industry, pipelineStage: lead.pipelineStage },
      findings, contact,
      flags: { isRejected: isRejectedLead(lead), isSuppressed: false, isDuplicate: false, marketTier: tierOf(lead.city, lead.state) },
    });
    const score = scoreTarget(input);

    // READY_FOR_NARRATION gate (mandate 28).
    const readiness = narrationReadiness({
      scoreBand: score.band, hasDisqualifier: score.terminalExclusions.length > 0,
      verifiedBusinessIdentity: !!lead.website,
      recipientVerified: input.recipient.verified, recipientResolutionTracked: input.recipient.role !== "none",
      hasStrongReputationSignal: input.reputationSignals.length > 0 && (lead.rating ?? 0) >= 4.0,
      hasSpecificWebsiteFinding: input.websiteFindings.some((f) => f.confidence >= 0.5),
      hasSupportedConsequence: input.hasSupportedConsequence,
      narrationEvidenceBacked: input.websiteFindings.length > 0,
      statementEvidenceMapComplete: true,
      hasUnsupportedClaims: false, excessiveSimilarity: false, narrationQualityPasses: words(narration) >= 40,
      hasCurrentScriptRevision: (template.revision ?? 0) >= 0,
      hasExistingAudioForCurrentRevision: false, hasCanonicalCompletedRender: false,
      renderState: "none", packageState: "none", needsAttention: false,
    });
    if (!readiness.ready || !mayAutoPrepare(score)) continue;

    const scriptRevisionId = `${lead.id}#r${template.revision ?? 0}`;
    const narrationHash = createHash("sha256").update(narration).digest("hex").slice(0, 16);
    const inputVersion = createHash("sha256").update(`${scriptRevisionId}|${narrationHash}`).digest("hex").slice(0, 16);
    const why = explainTarget(input, score, routeAsset(score, { videoCapacityAvailable: true }), `${input.city}, ${input.state} — ${input.marketTier}`);
    cards[lead.id] = {
      leadId: lead.id, businessName: lead.businessName, market: `${input.city}, ${input.state} · ${input.marketTier}`,
      band: score.band, score: score.total, whyShort: why.strongestOpportunity,
      recipientRole: input.recipient.role, recipientVerified: input.recipient.verified,
      narration, scriptRevisionId, narrationHash, inputVersion,
      wordCount: words(narration), estimatedSeconds: Math.round((words(narration) * 60) / 150),
    };
    rankables.push({ leadId: lead.id, score: score.total, growth: input.growthSignals.length, evidenceFreshnessTs: now, recipientConfidence: input.recipient.confidence, readySinceTs: 0 });
  }

  const readyLeadIds = orderForSprint(rankables);
  return { readyLeadIds, cards, readyCount: readyLeadIds.length };
}

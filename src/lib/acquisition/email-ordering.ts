// ─────────────────────────────────────────────────────────────────────────────
// Email prospect ordering — the live wiring of prospectPriority() into the board.
//
// Among the QUALIFIED, PREPARED email prospects the operator can send today, order by the
// best intersection of strong fundamentals (fit) + an established business + observed
// receptivity evidence. Fit stays foundational; receptivity is a bounded, evidence-based
// nudge that only breaks near-ties (see prospect-priority.ts) — never presented as predicted
// buying intent. Market receptivity (the regional-market experiment) is already folded into
// each lead's leadScore by computeScore, so it needs no separate term here.
//
// "Why now" is the operator-facing one-liner: the business's OWN observed evidence, with the
// signal's provenance available on expand. It appears only when a strong observed signal
// exists — otherwise there is simply no "why now" and the existing high-quality copy stands.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import type { BusinessProfile } from "../business-intelligence/types";
import { receptivitySignalsFrom, receptivityScore, receptivityAngle, type ReceptivitySignal } from "./receptivity";
import { prospectPriority } from "./prospect-priority";

/**
 * Is this a business with a real, operating footprint? Established = a genuine business we
 * wouldn't want to skip, so a bounded receptivity signal is allowed to nudge it. Deliberately
 * conservative: a footprint on the map (reviews) OR a real website presence. A tiny/no-footprint
 * record never becomes "established", so a signal alone can never make it attractive.
 */
export function establishedBusiness(lead: Lead): boolean {
  const reviews = lead.reviewCount ?? 0;
  const rating = lead.rating ?? 0;
  return reviews >= 10 || (!!lead.website && reviews >= 3 && rating > 0);
}

export interface EmailProspectRank {
  leadId: string;
  /** Final ranking value (fit + bounded receptivity boost). Higher sorts first. */
  total: number;
  fit: number;
  receptivityBoost: number;
  receptivityScore: number;
  signalTypes: string[];
  /** Operator-facing "why now" — the business's own observed evidence. Null when no strong signal. */
  whyNow: string | null;
  because: string[];
}

/** Compute the priority for a single email prospect from its lead + (optional) BI profile. Pure. */
export function rankEmailProspect(input: { lead: Lead; profile?: BusinessProfile | null; generatedAt?: string | null }): EmailProspectRank {
  const signals: ReceptivitySignal[] = input.profile
    ? receptivitySignalsFrom({ opportunities: input.profile.opportunities, generatedAt: input.generatedAt ?? null })
    : [];
  const recScore = receptivityScore(signals);
  const priority = prospectPriority({
    fitScore: input.lead.leadScore ?? 0,
    receptivity: recScore,
    established: establishedBusiness(input.lead),
  });
  return {
    leadId: input.lead.id,
    total: priority.total,
    fit: priority.fit,
    receptivityBoost: priority.receptivityBoost,
    receptivityScore: recScore,
    signalTypes: [...new Set(signals.map((s) => s.type))],
    whyNow: receptivityAngle(input.lead.businessName, signals),
    because: priority.because,
  };
}

export interface EmailOrdering {
  /** leadId → rank value (higher = earlier). For sorting the email batch. */
  order: Map<string, number>;
  /** leadId → the full rank detail (for surfacing "Why now" + provenance). */
  ranks: Map<string, EmailProspectRank>;
}

/**
 * Rank every email prospect. `biByLead` supplies each lead's BusinessProfile (opportunities +
 * generatedAt) when available; a lead with no BI still ranks on fit alone (receptivity 0).
 * Ties break deterministically by leadId so the order never churns between renders.
 */
export function orderEmailProspects(input: {
  leads: Lead[];
  biByLead: Map<string, { businessProfile?: BusinessProfile | null; generatedAt?: string | null }>;
}): EmailOrdering {
  const ranks = new Map<string, EmailProspectRank>();
  for (const lead of input.leads) {
    const bi = input.biByLead.get(lead.id);
    ranks.set(lead.id, rankEmailProspect({ lead, profile: bi?.businessProfile ?? null, generatedAt: bi?.generatedAt ?? null }));
  }
  const order = new Map<string, number>();
  for (const [id, r] of ranks) order.set(id, r.total);
  return { order, ranks };
}

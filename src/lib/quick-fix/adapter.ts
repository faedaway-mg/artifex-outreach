// ─────────────────────────────────────────────────────────────────────────────
// ADAPTER — bridge the existing Business Intelligence layer to the offer engine.
//
// Maps BI ModernizationOpportunity records (the canonical, evidence-backed
// findings) into the engine's OfferFinding shape, and offers a one-call
// buildOfferForLead(). Read-only: it derives, it never mutates.
// ─────────────────────────────────────────────────────────────────────────────
import type { OfferFinding, QuickFixOffer, AutomationLevel } from "./types";
import { generateOffer } from "./offer-engine";
import type { EconomicsThreshold } from "./economics";

/** A minimal view of a BI opportunity — matches business-intelligence/types.ts. */
export interface BiOpportunityLike {
  id: string;
  category: string;
  observation: string;
  whyItMatters: string;
  estimatedImpact?: { level?: string };
  confidence?: { label?: string; score?: number };
  basis?: string[];
}

export function toOfferFindings(opportunities: BiOpportunityLike[]): OfferFinding[] {
  return (opportunities ?? []).map((o) => ({
    id: String(o.id),
    category: String(o.category ?? ""),
    observation: String(o.observation ?? ""),
    whyItMatters: String(o.whyItMatters ?? ""),
    confidenceLabel: String(o.confidence?.label ?? "Unknown"),
    confidenceScore: typeof o.confidence?.score === "number" ? o.confidence!.score! : 0,
    impactLevel: String(o.estimatedImpact?.level ?? "Incremental"),
    basis: Array.isArray(o.basis) ? o.basis.map(String) : [],
  }));
}

export interface BuildOfferForLeadInput {
  leadId: string;
  companyName: string;
  opportunities: BiOpportunityLike[];
  /** Whether the business has a functioning website. Derived if omitted. */
  hasWebsite?: boolean;
  /** The lead's website URL (used to derive hasWebsite when not supplied). */
  website?: string | null;
  automationLevel?: AutomationLevel;
  threshold?: EconomicsThreshold;
  copy?: { offerName?: string; proposedSolution?: string };
  generatedAt?: string | null;
}

const NO_WEBSITE_RE = /\bno (owned |functioning )?website\b|no website|without a website|only (a |an )?(google business|facebook|word of mouth)/i;

/** Derive whether the business has a functioning website from the URL + evidence. */
export function deriveHasWebsite(website: string | null | undefined, opportunities: BiOpportunityLike[]): boolean {
  if (!website) return false;
  // A finding that explicitly says "no owned website" overrides a stale URL.
  return !(opportunities ?? []).some((o) => NO_WEBSITE_RE.test(String(o.observation ?? "")));
}

/** Convenience: BI opportunities → assembled offer for a lead. */
export function buildOfferForLead(input: BuildOfferForLeadInput): QuickFixOffer {
  const findings = toOfferFindings(input.opportunities);
  const hasWebsite = input.hasWebsite ?? deriveHasWebsite(input.website, input.opportunities);
  return generateOffer({
    leadId: input.leadId,
    companyName: input.companyName,
    findings,
    hasWebsite,
    automationLevel: input.automationLevel,
    threshold: input.threshold,
    copy: input.copy,
    generatedAt: input.generatedAt ?? null,
  });
}

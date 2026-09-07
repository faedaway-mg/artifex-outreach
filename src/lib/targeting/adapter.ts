// ─────────────────────────────────────────────────────────────────────────────
// TARGETING ADAPTER (mandate 27). Maps CANONICAL data (Lead + BusinessProfile opportunities + Quick-Review
// findings + resolved Contact + market classification + terminal-exclusion checks) into the pure scoring
// engine's TargetingInput. No parallel data model — it only reads existing canonical shapes. Pure + testable.
// ─────────────────────────────────────────────────────────────────────────────
import type { TargetingInput, TargetingSignal } from "./scoring";
import { resolveRecipient, type ContactLike } from "./prepare";
import type { MarketTierSize } from "../market-policy";

export interface AdapterLead {
  id: string; businessName: string; city: string | null; state: string | null;
  website: string | null; reviewCount: number | null; rating: number | null; locationsCount: number | null;
  industry: string | null; pipelineStage?: string | null;
}
export interface AdapterFinding { id: string; observation: string; whyItMatters?: string | null; confidenceScore?: number; sourceUrl?: string | null; generic?: boolean }
export interface AdapterFlags {
  isRejected: boolean; isSuppressed: boolean; isDuplicate: boolean; isSynthetic?: boolean; policyExhausted?: boolean;
  marketTier: MarketTierSize; recentlyOversaturated?: boolean;
  ownerRepliesToReviews?: boolean; hasAwardsOrLongHistory?: boolean; ownerNamedOnSite?: boolean;
  strongModernConversionSite?: boolean; growthSignals?: TargetingSignal[];
}

// High-consideration verticals (Tier A/B, mandate 27) where one extra customer is meaningfully valuable.
const HIGH_CONSIDERATION = /roof|remodel|restoration|hvac|plumb|electric|pool|landscap|hardscap|property|auto|collision|dental|legal|law|account|insurance|financ|med spa|wellness|manufactur/i;
// National-enterprise detection requires OBSERVABLE STRUCTURAL evidence — a legal-suffix token in the NAME
// ("Inc.", "Group", "Corp", "LLC") can NEVER by itself establish enterprise status (mandate 29 §4): a small
// local "Air Max HVAC Inc." or "MK&C Dental Group" is exactly our persona. The only name-based flags kept are
// UNAMBIGUOUS national/public descriptors; the primary signal is >10 (uncontrolled) locations. Ambiguous
// cases are NOT auto-excluded — they flow to the normal score (→ manual review / needs-recipient), never a
// terminal exclusion. FRANCHISE_BRAND stays (explicit corporate franchise brands, incl. H&R Block).
const NATIONAL_PUBLIC_NAME = /\bnationwide\b|\bnational (association|corporation)\b|\bpublicly[- ]traded\b|\b(inc|corp)\.? holdings\b/i;
const FRANCHISE_BRAND = /\b(mcdonald|subway|starbucks|servpro|jan-?pro|the ups store|great clips|anytime fitness|jiffy lube|midas|meineke|h&r block|re\/max|keller williams)\b/i;

const mapTier = (t: MarketTierSize): TargetingInput["marketTier"] =>
  t === "secondary" || t === "tertiary" || t === "primary" || t === "micro" ? t : "unknown";

export function buildTargetingInput(args: {
  lead: AdapterLead;
  findings: AdapterFinding[];
  contact: ContactLike | null;
  flags: AdapterFlags;
}): TargetingInput {
  const { lead, findings, contact, flags } = args;
  const websiteFindings: TargetingSignal[] = findings.map((f) => ({
    id: f.id, kind: "digital-underrepresentation", observation: f.observation, sourceUrl: f.sourceUrl ?? null,
    confidence: Math.max(0, Math.min(1, f.confidenceScore ?? 0.7)),
  }));
  const reviewCount = lead.reviewCount ?? 0;
  const rating = lead.rating ?? 0;
  const reputationSignals: TargetingSignal[] = reviewCount > 0
    ? [{ id: `rep_${lead.id}`, kind: "reputation", observation: `${reviewCount} reviews at ${rating}★`, confidence: rating >= 4.0 ? 0.9 : 0.6 }]
    : [];
  const recipient = resolveRecipient(contact);
  const locationsCount = lead.locationsCount ?? 1;
  // Enterprise requires STRUCTURAL evidence (>10 uncontrolled locations) or an unambiguous national/public
  // name descriptor — NEVER a bare legal suffix (Inc/Group/Corp/LLC).
  const enterprise = locationsCount > 10 || NATIONAL_PUBLIC_NAME.test(lead.businessName);
  const franchise = FRANCHISE_BRAND.test(lead.businessName);
  const hasSupportedConsequence = findings.some((f) => (f.whyItMatters ?? "").trim().length > 0);
  const genericFindingOnly = findings.length > 0 && findings.every((f) => f.generic === true);

  return {
    leadId: lead.id, businessName: lead.businessName, city: lead.city ?? "", state: lead.state ?? "",
    isEnterpriseOrPublic: enterprise,
    isFranchiseCorporateControlled: franchise && !(recipient.locallyControlled && recipient.verified), // an independent, locally-controlled franchisee is NOT excluded
    isRejected: flags.isRejected, isSuppressed: flags.isSuppressed, isDuplicate: flags.isDuplicate,
    isSynthetic: !!flags.isSynthetic, policyExhausted: !!flags.policyExhausted,
    hasFunctioningWebsite: !!lead.website,
    marketTier: mapTier(flags.marketTier), recentlyOversaturated: !!flags.recentlyOversaturated,
    reviewCount, rating,
    ownerRepliesToReviews: !!flags.ownerRepliesToReviews, hasAwardsOrLongHistory: !!flags.hasAwardsOrLongHistory,
    websiteFindings, hasSupportedConsequence, strongModernConversionSite: !!flags.strongModernConversionSite, genericFindingOnly,
    reputationSignals, growthSignals: flags.growthSignals ?? [],
    recipient, ownerNamedOnSite: !!flags.ownerNamedOnSite,
    highConsiderationService: HIGH_CONSIDERATION.test(lead.industry ?? "") || HIGH_CONSIDERATION.test(lead.businessName),
    locationsCount, weakCommercialViability: reviewCount < 15 && rating < 4.0,
    lowConfidenceOwnership: (recipient.role === "owner" || recipient.role === "founder") && recipient.confidence < 0.5,
  };
}

// ── BACKLOG AGGREGATION ──────────────────────────────────────────────────────────
import type { TargetingScore } from "./scoring";
export interface BacklogCounts {
  total: number; priorityA: number; priorityB: number; review: number; needsRecipient: number; needsEvidence: number;
  doNotPrepare: number; ineligible: number; autoPrepareEligible: number;
}
// Count by the canonical PERSONA-FIT classification (promotionState), so a good fit merely lacking a recipient
// is surfaced as NEEDS_RECIPIENT — never buried in "ineligible" (persona-gate point 6).
export function backlogCounts(scores: TargetingScore[]): BacklogCounts {
  const c: BacklogCounts = { total: scores.length, priorityA: 0, priorityB: 0, review: 0, needsRecipient: 0, needsEvidence: 0, doNotPrepare: 0, ineligible: 0, autoPrepareEligible: 0 };
  for (const s of scores) {
    switch (s.promotionState) {
      case "PRIORITY_A": c.priorityA++; c.autoPrepareEligible++; break;
      case "PRIORITY_B": c.priorityB++; c.autoPrepareEligible++; break;
      case "MANUAL_REVIEW": c.review++; break;
      case "NEEDS_RECIPIENT": c.needsRecipient++; break;
      case "NEEDS_EVIDENCE": c.needsEvidence++; break;
      case "DO_NOT_PREPARE": c.doNotPrepare++; break;
      default: c.ineligible++;
    }
  }
  return c;
}

/** Exclusion tally by terminal reason (for the campaign preview "hard exclusions by reason"). */
export function exclusionsByReason(scores: TargetingScore[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of scores) for (const r of s.terminalExclusions) out[r] = (out[r] ?? 0) + 1;
  return out;
}

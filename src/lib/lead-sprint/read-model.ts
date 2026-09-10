// ─────────────────────────────────────────────────────────────────────────────
// LEAD SPRINT READ-MODEL (track #183) — composes the REAL deterministic scorers over real leads into a
// LeadSprintReport. This is the seam the cron/dashboard calls: it maps each Lead through computeScore
// (opportunity) + buildTargetingInput→scoreTarget (persona) + the Sprint adapter, then runs the free
// engine. PURE with respect to its inputs — the caller supplies each lead's context bundle (findings,
// contact, suppression, offer-readiness), so this module performs NO storage I/O, NO paid calls, and NO
// prospect contact. Raw discovered leads land in the ranked pool; only leads with a constructible,
// evidence-backed, reachable package become finalists — exactly the broad-pool / few-finalists shape.
// ─────────────────────────────────────────────────────────────────────────────
import type { Lead } from "../types";
import { computeScore } from "../scoring";
import { marketTierOf, type MarketTier } from "../geo-market";
import { buildTargetingInput, type AdapterFinding } from "../targeting/adapter";
import { scoreTarget } from "../targeting/scoring";
import type { ContactLike } from "../targeting/prepare";
import type { MarketTierSize } from "../market-policy";
import { podForLocation } from "./pods";
import { buildSprintCandidate } from "./adapter";
import { runLeadSprint, type SprintCandidate, type LeadSprintReport } from "./engine";
import { classifyLead, type LegacyClassifyOverrides } from "./legacy-active";

/** Everything the read-model needs about ONE lead beyond the Lead row itself. The caller assembles this
 *  from the repo (findings, resolved contact, suppression) + offer/package readiness. Offer-readiness
 *  fields default conservatively so a raw lead is a POOL member but never a finalist until it truly has a
 *  constructible package. */
export interface LeadSprintContext {
  lead: Lead;
  findings: AdapterFinding[];
  contact: ContactLike | null;
  isSuppressed: boolean;
  isDuplicate: boolean;
  // ── package/offer readiness for Production Confidence (all cheap/deterministic; false when unknown) ──
  quickFixEligible: boolean;
  clearsMarginGate: boolean;
  voiceGenerationResolved: boolean;
  compatibleTrustAvailable: boolean;
  isSynthetic?: boolean;
}

// Bridge geo-market's tier (primary/secondary/regional) to the targeting engine's MarketTierSize. A
// "regional" market maps to "tertiary" (the targeting model's less-saturated tier); this keeps ONE
// market truth without leads needing Census populations.
function marketTierSize(lead: Lead): MarketTierSize {
  const t: MarketTier = marketTierOf(lead);
  return t === "primary" ? "primary" : t === "secondary" ? "secondary" : "tertiary";
}

/** Map one lead + its context into a SprintCandidate using the real scorers. Deterministic; no I/O. */
export function sprintCandidateFromLead(ctx: LeadSprintContext): SprintCandidate {
  const { lead } = ctx;
  const opportunity = computeScore(lead);

  const targeting = scoreTarget(
    buildTargetingInput({
      lead: {
        id: lead.id, businessName: lead.businessName, city: lead.city, state: lead.state,
        website: lead.website, reviewCount: lead.reviewCount, rating: lead.rating,
        locationsCount: lead.locationsCount, industry: lead.industry, pipelineStage: lead.pipelineStage,
      },
      findings: ctx.findings,
      contact: ctx.contact,
      flags: {
        isRejected: lead.pipelineStage === "Rejected" || lead.pipelineStage === "Disqualified",
        isSuppressed: ctx.isSuppressed,
        isDuplicate: ctx.isDuplicate,
        isSynthetic: !!ctx.isSynthetic,
        marketTier: marketTierSize(lead),
      },
    }),
  );

  // Material evidence = ≥1 specific finding (confidence ≥0.5) AND a supported consequence.
  const materialEvidence =
    ctx.findings.some((f) => (f.confidenceScore ?? 0.7) >= 0.5) &&
    ctx.findings.some((f) => (f.whyItMatters ?? "").trim().length > 0);
  // Reachable contact = a verified recipient with a real (non-inbox/none) role.
  const recipient = targeting.components.decisionMakerAccess > 0 && targeting.reasons.length > 0;
  const reachableContact = !!ctx.contact && recipient;

  return buildSprintCandidate({
    lead: { id: lead.id, businessName: lead.businessName, city: lead.city, state: lead.state },
    opportunity,
    targeting,
    gates: {
      isDuplicate: ctx.isDuplicate,
      isSuppressed: ctx.isSuppressed,
      quickFixEligible: ctx.quickFixEligible,
      clearsMarginGate: ctx.clearsMarginGate,
      materialEvidence,
      reachableContact,
      voiceGenerationResolved: ctx.voiceGenerationResolved,
      compatibleTrustAvailable: ctx.compatibleTrustAvailable,
    },
  });
}

export interface BuildReportOpts {
  nearTermCapacity: number;
  /** When true, restrict the pool to the four initial priority pods + their expansion states. */
  podsOnly?: boolean;
}

/** The read-model report = the engine report PLUS the legacy-exclusion accounting (§4). */
export interface LeadSprintReadModelReport extends LeadSprintReport {
  /** Total leads excluded from ACTIVE operations by the legacy classifier (preserved in history). */
  excludedLegacy: number;
  excludedLegacyArchived: number;      // LEGACY_ARCHIVED
  excludedLegacyDisqualified: number;  // DISQUALIFIED_LEGACY
}

/**
 * Build the full report from real lead contexts. Deterministic; no paid calls; no contact.
 *
 * §4 LEGACY EXCLUSION runs FIRST: any lead the classifier marks LEGACY_ARCHIVED / DISQUALIFIED_LEGACY is
 * removed from the ACTIVE pipeline (never scored, pooled, ranked, or made a finalist) — so it can never
 * reach Ready-to-Send or sender allocation. It is only counted here (excludedLegacy*), never contacted;
 * its history/evidence/suppression remain intact in the store for the Archive/History surfaces.
 */
export function buildLeadSprintReport(
  contexts: LeadSprintContext[],
  opts: BuildReportOpts,
): LeadSprintReadModelReport {
  // Exclude legacy/disqualified BEFORE anything else. A context may carry stronger override signals.
  let archived = 0;
  let disqualified = 0;
  const active = contexts.filter((c) => {
    const overrides: LegacyClassifyOverrides = {
      isDuplicateHistorical: c.isDuplicate || undefined,
      inCurrentTargetMarket: podForLocation(c.lead.city, c.lead.state).pod !== null ? true : undefined,
    };
    const disposition = classifyLead(c.lead, overrides).disposition;
    if (disposition === "LEGACY_ARCHIVED") { archived++; return false; }
    if (disposition === "DISQUALIFIED_LEGACY") { disqualified++; return false; }
    return true;
  });

  const scoped = opts.podsOnly
    ? active.filter((c) => podForLocation(c.lead.city, c.lead.state).pod !== null)
    : active;
  const candidates: SprintCandidate[] = scoped.map(sprintCandidateFromLead);
  const report = runLeadSprint({ candidates, nearTermCapacity: opts.nearTermCapacity });
  return {
    ...report,
    excludedLegacy: archived + disqualified,
    excludedLegacyArchived: archived,
    excludedLegacyDisqualified: disqualified,
  };
}

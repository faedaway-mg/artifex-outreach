// ─────────────────────────────────────────────────────────────────────────────
// QUALIFICATION ADAPTER — maps a real Lead (+ its generated offer + BI profile)
// into the pure signal inputs the strict funnel consumes, then runs qualifyLead().
// This is the single bridge between stored inventory and the qualification gates,
// so the funnel logic stays pure/testable and the extraction rules live in one
// place. No fabrication: every signal is read from real data or left unset (0).
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { assessContactability, type Contactability } from "./contactability";
import { assessCommercialFit, type CommercialFit } from "./commercial-fit";
import { assessCompetitiveOverlap, type CompetitiveOverlap } from "./competitive-overlap";
import { sendEligibility, inferCountry, type JurisdictionVerdict } from "./jurisdiction";
import { assessFixability } from "./fixability";
import { familyOf } from "./catalog";
import { qualifyLead, type Qualification } from "./qualification";
import { assessOfferCustomerLanguage } from "./customer-language";

/** Minimal structural view of a Lead — decoupled from the full repo type. */
export interface LeadLike {
  id: string;
  website?: string | null;
  publicEmail?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  industry?: string | null;
  normalizedCategory?: string | null;
  categoryGroup?: string | null;
  businessStatus?: string | null;
  reviewCount?: number | null;
  rating?: number | null;
  locationsCount?: number | null;
  contactFormUrl?: string | null;
}

export interface LeadQualification {
  leadId: string;
  qualification: Qualification;
  contactability: Contactability;
  commercialFit: CommercialFit;
  overlap: CompetitiveOverlap;
  jurisdiction: JurisdictionVerdict;
  /** Convenience: the sendable price for this lead (0 unless ready to sell). */
  sendablePriceCents: number;
}

function biProfile(bi: any): any {
  return bi?.profile?.businessProfile ?? bi?.businessProfile ?? null;
}

/** Extract overlap text signals from the BI profile when present. */
function overlapSignalsFor(lead: LeadLike, bi: any) {
  const p = biProfile(bi);
  return {
    industry: lead.industry ?? null,
    category: lead.normalizedCategory ?? null,
    categoryGroup: lead.categoryGroup ?? null,
    description: (p?.description ?? p?.summary ?? null) as string | null,
    services: Array.isArray(p?.services) ? p.services.map((s: any) => (typeof s === "string" ? s : s?.name)).filter(Boolean) : null,
    tags: Array.isArray(p?.tags) ? p.tags : null,
  };
}

/**
 * Qualify one lead. offer may be null (no BI profile / no productizable fix) — the
 * funnel still runs and simply won't reach READY_TO_SELL. Pure given its inputs.
 */
export function qualifyLeadRecord(args: {
  lead: LeadLike;
  offer: QuickFixOffer | null;
  bi?: any;
  suppressed?: boolean;
  bounced?: boolean;
  /**
   * Optional OFFER-READINESS verdict (Part U). When the caller has assembled the offer
   * artifact and run assessOfferReadiness, pass {ready, blockers} here so the funnel can
   * expose READY_TO_SEND separately from sales qualification. Omitted ⇒ readiness not
   * evaluated (does not block). Readiness is evaluated by offer-readiness.ts, which needs
   * the full customer-facing artifact — deliberately supplied by the caller, not re-
   * derived here, to keep this adapter free of route/generator internals.
   */
  readiness?: { ready: boolean; blockers?: string[] };
}): LeadQualification {
  const { lead, offer, bi, suppressed = false, bounced = false, readiness } = args;

  const contactability = assessContactability({
    email: lead.publicEmail ?? null,
    website: lead.website ?? null,
    bounced,
    // provenance is inferred inside (own-domain ⇒ official-website); we don't fake verification.
  });

  const fix = offer ? assessFixability(offer) : null;
  const matchedSku = fix?.matchedSku ?? offer?.capabilityKeys[0] ?? null;
  const family = matchedSku ? familyOf(matchedSku) : null;
  const defectAffectsCommercialAction = !!offer && (family === "CONVERSION" || family === "LEAD_FLOW" || family === "WEBSITE_FUNCTION");

  const commercialFit = assessCommercialFit({
    hasActiveWebsite: !!lead.website && lead.businessStatus !== "CLOSED_PERMANENTLY",
    hasCommercialIntent: !!offer || !!lead.contactFormUrl,
    reviewCount: lead.reviewCount ?? null,
    locationsCount: lead.locationsCount ?? null,
    multipleServices: Array.isArray(biProfile(bi)?.services) ? biProfile(bi).services.length >= 2 : undefined,
    establishedDomain: (lead.reviewCount ?? 0) >= 20 || (lead.locationsCount ?? 0) >= 2,
    defectAffectsCommercialAction,
    priceCents: offer?.priceCents ?? null,
    effectiveHourlyCents: offer?.economics.effectiveHourlyCents ?? null,
    strongSkuSupport: !!matchedSku && !!offer?.quickFixEligible,
  });

  const overlap = assessCompetitiveOverlap(overlapSignalsFor(lead, bi));
  const jurisdiction = sendEligibility(inferCountry({ state: lead.state ?? null, country: lead.country ?? null }));

  // Plain-language gate over the offer's customer-facing copy. Only applicable when
  // an offer exists to inspect; otherwise leave undefined (not blocking) so leads
  // without a generated offer fail elsewhere in the funnel, not here.
  const customerLanguage = offer ? assessOfferCustomerLanguage(offer) : null;

  const qualification = qualifyLead({
    hasWebsite: !!lead.website,
    contactability,
    suppressed,
    businessActive: lead.businessStatus !== "CLOSED_PERMANENTLY",
    commercialFit,
    overlap,
    readyToSellFix: !!fix?.readyToSell,
    matchedSku,
    confidence: offer?.confidence ?? 0,
    hasObservedDefect: !!offer && (offer.evidenceGrade === "OBSERVED" || offer.confidence >= 0.6),
    clearsMarginGate: offer?.economics.clearsMarginGate ?? false,
    jurisdiction,
    customerLanguageClean: customerLanguage ? customerLanguage.passes : undefined,
    customerLanguageProblems: customerLanguage?.problems,
    offerReady: readiness ? readiness.ready : undefined,
    offerReadinessBlockers: readiness?.blockers,
  });

  return {
    leadId: lead.id,
    qualification,
    contactability,
    commercialFit,
    overlap,
    jurisdiction,
    sendablePriceCents: qualification.readyToSell ? offer?.priceCents ?? 0 : 0,
  };
}

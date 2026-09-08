// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX / LOW-TICKET REVENUE ENGINE — shared types.
//
// The engine turns an evidence-backed detected problem into a productized,
// fixed-price offer ($250 / $495 / $995) with a direct Stripe checkout, a
// fulfillment job, an optional recurring maintenance plan, and an upsell/referral
// lineage — optimizing REVENUE PER OPERATOR HOUR, not contract size.
//
// Hard separation of concerns lives in the field names below:
//   • PRICE is deterministic (pricing.ts). The LLM never prices.
//   • CAPABILITY is gated (capabilities.ts). We only sell what we can deliver.
//   • EVIDENCE is gated (evidence-gate.ts). We never fabricate a deficiency.
//   • INTERNAL economics/margin never appear in customer-facing text.
// ─────────────────────────────────────────────────────────────────────────────

/** The three customer-facing fixed anchors. Extensible: add a tier to TIERS. */
export type PricingBand = "ENTRY" | "GROWTH" | "MINI";

/** Evidence strength for a claim we make to a prospect. Derived, never invented. */
export type EvidenceGrade = "OBSERVED" | "INFERRED" | "UNKNOWN";

/** Automation posture for an offer class. Production default is ASSISTED. */
export type AutomationLevel = "MANUAL" | "ASSISTED" | "AUTO_ELIGIBLE";

/** Capability delivery-readiness. We only sell APPROVED/AVAILABLE/PROVEN. */
export type CapabilityState = "PROVEN" | "AVAILABLE" | "APPROVED" | "PLANNED" | "UNSUPPORTED";

/** Offer lifecycle — a superset adapted onto existing pipeline/job records. */
export type OfferState =
  | "DRAFT"
  | "APPROVED"
  | "SENT"
  | "VIEWED"
  | "CHECKOUT_STARTED"
  | "PAID"
  | "SUPERSEDED"
  | "DECLINED"
  | "EXPIRED";

/** Fulfillment job lifecycle after payment. */
export type JobState =
  | "PAID"
  | "WAITING_FOR_CUSTOMER_INPUT"
  | "READY_FOR_FULFILLMENT"
  | "IN_PROGRESS"
  | "QA"
  | "DELIVERED"
  | "COMPLETE"
  | "REFUNDED"
  | "CANCELED";

/** Subscription (maintenance) lifecycle mirrored from Stripe (source of truth). */
export type SubscriptionState =
  | "NONE"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "INCOMPLETE";

/** A finding as consumed by the engine — mapped from a BI ModernizationOpportunity. */
export interface OfferFinding {
  id: string;
  category: string; // OpportunityCategory
  observation: string;
  whyItMatters: string;
  confidenceLabel: string; // Observed | Reported | Likely | Inferred | Unknown
  confidenceScore: number; // 0..1
  impactLevel: string; // Foundational | High | Moderate | Incremental
  basis: string[]; // provenance — never empty for a real finding
}

/** Internal-only economics. NEVER serialized into customer-facing text. */
export interface OfferEconomics {
  priceCents: number;
  estimatedHours: number;
  externalCostCents: number; // third-party pass-through (hosting/licenses/APIs)
  grossContributionCents: number; // price - externalCost
  effectiveHourlyCents: number; // grossContribution / estimatedHours
  deliveryRisk: "low" | "medium" | "high";
  supportBurden: "low" | "medium" | "high";
  /** Whether the offer clears the configured minimum-economics threshold. */
  clearsMarginGate: boolean;
  marginReasons: string[];
}

/** Customer-facing scope. This is the ONLY representation the prospect ever sees. */
export interface OfferScope {
  offerName: string; // e.g. "48-Hour Lead Capture Fix"
  problemBeingSolved: string; // plain, evidence-graded language
  proposedSolution: string;
  includedItems: string[];
  excludedItems: string[];
  customerInputsRequired: string[];
  deliveryWindow: string; // e.g. "Delivered within 48 hours of receiving access"
  revisionPolicy: string;
}

/** A recommended recurring maintenance attachment (optional). */
export interface MaintenanceRecommendation {
  planKey: string;
  planName: string;
  monthlyCents: number;
  rationale: string;
}

/** The full assembled offer. Persisted + versioned. */
export interface QuickFixOffer {
  offerId: string;
  leadId: string;
  companyName: string;
  findingIds: string[];
  capabilityKeys: string[];

  band: PricingBand;
  priceCents: number;
  currency: string;

  scope: OfferScope;
  evidenceGrade: EvidenceGrade;
  confidence: number; // 0..1 rolled up from findings, de-duped
  rationale: string; // WHY this offer + WHY this price (operator-facing)

  economics: OfferEconomics; // INTERNAL
  maintenance: MaintenanceRecommendation | null;

  /** True only for a genuinely productizable quick fix. Else → book-a-call. */
  quickFixEligible: boolean;
  /** Populated when NOT quick-fix eligible — the honest reason + fallback CTA. */
  notEligibleReason: string | null;

  automationLevel: AutomationLevel;
  offerVersion: string; // deterministic hash of price-relevant inputs
  state: OfferState;
  generatedAt: string | null;
}

/** Result of the productizability + eligibility decision. */
export interface EligibilityDecision {
  quickFixEligible: boolean;
  band: PricingBand | null;
  reason: string;
  fallback: "PURCHASE" | "BOOK_A_CONVERSATION" | "SOFT_DIAGNOSTIC" | "DECLINE";
}

import { createHash } from "node:crypto";
// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE PLANS — controlled recurring SKUs (~$49/month). Fixed, explicitly
// scoped, and bounded so a $49 plan can NEVER silently become unlimited labor.
// The LLM may recommend WHICH plan is relevant; it may not invent plans, prices,
// or scope. Out-of-scope work always triggers a NEW fixed-price offer.
// ─────────────────────────────────────────────────────────────────────────────

export interface MaintenancePlan {
  key: string;
  name: string;
  monthlyCents: number;
  interval: "month";
  /** Tight, explicit scope. */
  includes: string[];
  /** Everything that is NOT included — routes to a new fixed-price offer. */
  excludes: string[];
  /** The precise definition of the single "small update" the plan permits. */
  smallUpdateDefinition: string;
  /** Response expectation the plan commits to. */
  responseExpectation: string;
  /** Which quick-fix capabilities this plan naturally follows. */
  followsCapabilities: string[];
}

const SMALL_UPDATE = "One minor update per month requiring 15 minutes or less (e.g. a text/CTA/link change). Not cumulative; unused updates do not roll over.";
const RESPONSE = "One business day for acknowledgement; scheduled work delivered within the monthly cycle.";
const COMMON_EXCLUDES = [
  "Redesigns or new page templates",
  "New pages or new features",
  "Major copywriting or content production",
  "Custom development or integrations",
  "Anything exceeding the monthly small-update limit — quoted as a new fixed-price offer",
];

export const MAINTENANCE_PLANS: MaintenancePlan[] = [
  {
    key: "lead-flow-care",
    name: "Lead Flow Care",
    monthlyCents: 4900,
    interval: "month",
    includes: [
      "Monthly test of your critical contact/lead form",
      "Broken CTA / broken link check",
      "Basic conversion-path health check",
      "One small update per month (see definition)",
    ],
    excludes: COMMON_EXCLUDES,
    smallUpdateDefinition: SMALL_UPDATE,
    responseExpectation: RESPONSE,
    followsCapabilities: ["cta-repair", "contact-form-repair", "lead-capture-package"],
  },
  {
    key: "site-check-care",
    name: "Monthly Site Check",
    monthlyCents: 4900,
    interval: "month",
    includes: [
      "Monthly site health check (uptime, broken links, obvious layout breakage)",
      "Mobile spot-check of key pages",
      "Metadata/share-preview spot-check",
      "One small update per month (see definition)",
    ],
    excludes: COMMON_EXCLUDES,
    smallUpdateDefinition: SMALL_UPDATE,
    responseExpectation: RESPONSE,
    followsCapabilities: ["metadata-seo-cleanup", "mobile-layout-fix", "trust-signal-install", "homepage-conversion-sprint"],
  },
  {
    key: "analytics-health-care",
    name: "Analytics Health Check",
    monthlyCents: 4900,
    interval: "month",
    includes: [
      "Monthly verification that analytics + conversion events are still firing",
      "Flag of any tracking that broke since last month",
      "A one-paragraph plain-language summary of the month",
      "One small update per month (see definition)",
    ],
    excludes: COMMON_EXCLUDES,
    smallUpdateDefinition: SMALL_UPDATE,
    responseExpectation: RESPONSE,
    followsCapabilities: ["analytics-install"],
  },
  {
    key: "accessibility-care",
    name: "Basic Accessibility Monitoring",
    monthlyCents: 4900,
    interval: "month",
    includes: [
      "Monthly automated accessibility scan of key pages",
      "Flag of new contrast/alt-text/focus regressions",
      "One small accessibility update per month (see definition)",
    ],
    excludes: COMMON_EXCLUDES,
    smallUpdateDefinition: SMALL_UPDATE,
    responseExpectation: RESPONSE,
    followsCapabilities: ["accessibility-quickfix"],
  },
];

const BY_KEY = new Map(MAINTENANCE_PLANS.map((p) => [p.key, p]));

export function maintenancePlanByKey(key: string | null | undefined): MaintenancePlan | null {
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

// ── Recurring-maintenance consent (separate affirmative opt-in) ──────────────────
/** The version of the recurring-consent language (bump if the text changes). */
export const MAINTENANCE_CONSENT_VERSION = "qf-recurring-consent-v1-2026-09";

/** The exact recurring-authorization statement a customer must separately affirm.
 *  Never buried in the one-time Quick-Fix checkbox. */
export function maintenanceConsentText(plan: MaintenancePlan): string {
  const amount = `$${Math.round(plan.monthlyCents / 100)}`;
  return `I authorize Artifex Labs to charge ${amount} every month for ${plan.name} until I cancel. ` +
    `I understand that the subscription automatically renews and that I can cancel online before my next billing date.`;
}

/**
 * The optional recurring-maintenance UPSELL is enabled ONLY when the operator has
 * configured a working online cancellation path (Stripe Billing Portal) and set the
 * env flag. It defaults OFF so the one-time Quick-Fix launch is never blocked and a
 * subscription is never sold without a usable self-service cancel path. When OFF,
 * the offer page shows no maintenance upsell and checkout is one-time only.
 */
export function maintenanceUpsellEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.QUICKFIX_MAINTENANCE_ENABLED === "true" && env.STRIPE_BILLING_PORTAL_CONFIGURED === "true";
}

/** Immutable record of a separate recurring-consent affirmation. */
export interface MaintenanceConsent {
  offerId: string;
  leadId: string;
  customerEmail: string;
  planKey: string;
  planName: string;
  monthlyCents: number;
  cadence: "month";
  consentVersion: string;
  consentText: string;
  acceptedAt: string;
  /** SHA-256 digest binding the consent to its exact terms. */
  digest: string;
}

export function buildMaintenanceConsent(args: { offerId: string; leadId: string; customerEmail: string; plan: MaintenancePlan; acceptedAt: string }): MaintenanceConsent {
  const { plan } = args;
  const consentText = maintenanceConsentText(plan);
  const digest = createHash("sha256")
    .update(JSON.stringify({
      offerId: args.offerId,
      email: args.customerEmail.toLowerCase(),
      planKey: plan.key,
      monthlyCents: plan.monthlyCents,
      cadence: "month",
      consentVersion: MAINTENANCE_CONSENT_VERSION,
      consentText,
      acceptedAt: args.acceptedAt,
    }))
    .digest("hex");
  return {
    offerId: args.offerId,
    leadId: args.leadId,
    customerEmail: args.customerEmail,
    planKey: plan.key,
    planName: plan.name,
    monthlyCents: plan.monthlyCents,
    cadence: "month",
    consentVersion: MAINTENANCE_CONSENT_VERSION,
    consentText,
    acceptedAt: args.acceptedAt,
    digest,
  };
}

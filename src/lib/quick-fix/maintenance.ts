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

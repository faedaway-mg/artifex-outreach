// ─────────────────────────────────────────────────────────────────────────────
// CAPABILITY REGISTRY — the single source of truth for what Artifex can actually
// sell as a quick fix. The offer engine may ONLY productize a capability whose
// state is PROVEN / AVAILABLE / APPROVED. The LLM cannot invent a capability.
//
// No such registry existed in-repo (FDF/ACEL lives in a separate repo), so this
// is the smallest clean registry that the engine needs. Each capability carries
// the deterministic delivery facts the pricing + economics + intake layers read.
// ─────────────────────────────────────────────────────────────────────────────
import type { CapabilityState } from "./types";

export interface AccessRequirement {
  /** Machine key, e.g. "wordpress-admin". */
  key: string;
  /** Customer-facing ask. Never asks for a password by email. */
  label: string;
  /** How the customer grants it securely (native platform invite, not a password). */
  howToGrant: string;
}

export interface Capability {
  key: string;
  name: string;
  state: CapabilityState;
  /** BI opportunity categories this capability can address. */
  addressesCategories: string[];
  /** Keyword hints matched against a finding observation for routing. */
  matchHints: string[];
  /** Deterministic effort band, in focused hours. Drives pricing + economics. */
  minHours: number;
  maxHours: number;
  /** Third-party pass-through cost for a typical delivery, in cents. */
  externalCostCents: number;
  /** Intrinsic delivery risk of the capability itself. */
  risk: "low" | "medium" | "high";
  /** Ongoing support burden if delivered. */
  supportBurden: "low" | "medium" | "high";
  /** Whether this fix requires discovery / a call before it can be scoped. */
  requiresDiscovery: boolean;
  /** Access the customer must grant for fulfillment. */
  accessRequirements: AccessRequirement[];
  /** Optional maintenance plan this capability naturally leads into. */
  maintenancePlanKey: string | null;
  /** Customer-facing description of the work (external copy seed). */
  solutionSummary: string;
  includedItems: string[];
  excludedItems: string[];
  revisionPolicy: string;
}

const WEBSITE_ADMIN: AccessRequirement = {
  key: "website-admin",
  label: "Editor/admin access to your website platform (WordPress, Squarespace, Webflow, Shopify, etc.)",
  howToGrant: "Send a collaborator/editor invite from your platform to our delivery address — never your password.",
};
const ANALYTICS_ACCESS: AccessRequirement = {
  key: "analytics-access",
  label: "Viewer or editor access to your Google Analytics / Tag Manager property",
  howToGrant: "Add our delivery address as a user in Analytics/Tag Manager admin.",
};

// ── The registry ─────────────────────────────────────────────────────────────
export const CAPABILITIES: Capability[] = [
  {
    key: "cta-repair",
    name: "Primary CTA Repair",
    state: "PROVEN",
    addressesCategories: ["Customer Acquisition", "Brand Experience"],
    matchHints: ["cta", "call to action", "button", "book", "contact button", "get a quote"],
    minHours: 1,
    maxHours: 2,
    externalCostCents: 0,
    risk: "low",
    supportBurden: "low",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN],
    maintenancePlanKey: "lead-flow-care",
    solutionSummary: "Reposition and repair your primary call-to-action so visitors can act without hunting for it.",
    includedItems: [
      "Reposition the primary CTA above the fold",
      "Fix or re-link the broken/misdirected action",
      "Mobile CTA correction",
      "Post-launch verification on desktop + mobile",
    ],
    excludedItems: ["Full homepage redesign", "New brand identity", "Net-new pages"],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "contact-form-repair",
    name: "Contact / Lead Form Repair",
    state: "PROVEN",
    addressesCategories: ["Customer Acquisition", "Communication"],
    matchHints: ["form", "contact form", "lead form", "submission", "inquiry", "buried contact"],
    minHours: 1,
    maxHours: 3,
    externalCostCents: 0,
    risk: "low",
    supportBurden: "low",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN],
    maintenancePlanKey: "lead-flow-care",
    solutionSummary: "Repair and simplify your contact path so inquiries actually reach you.",
    includedItems: [
      "Fix broken/failing form submission",
      "Simplify the contact path to the essential fields",
      "Confirm delivery of submissions to your inbox",
      "Mobile form usability pass",
    ],
    excludedItems: ["CRM buildout", "Marketing automation", "Custom integrations"],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "metadata-seo-cleanup",
    name: "Metadata & Title Cleanup",
    state: "PROVEN",
    addressesCategories: ["Customer Acquisition", "Analytics"],
    matchHints: ["metadata", "title tag", "meta description", "seo basics", "page title", "duplicate title"],
    minHours: 1,
    maxHours: 2,
    externalCostCents: 0,
    risk: "low",
    supportBurden: "low",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN],
    maintenancePlanKey: "site-check-care",
    solutionSummary: "Clean up page titles and descriptions so search + shares represent you correctly.",
    includedItems: [
      "Correct titles/descriptions on primary pages",
      "Fix duplicate or placeholder metadata",
      "Set a sensible default share preview",
    ],
    excludedItems: ["Full SEO campaign", "Content writing at scale", "Link building"],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "analytics-install",
    name: "Analytics Visibility Setup",
    state: "PROVEN",
    addressesCategories: ["Analytics", "Reporting"],
    matchHints: ["analytics", "tracking", "no analytics", "measurement", "conversion tracking", "events"],
    minHours: 1,
    maxHours: 3,
    externalCostCents: 0,
    risk: "low",
    supportBurden: "low",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN, ANALYTICS_ACCESS],
    maintenancePlanKey: "analytics-health-care",
    solutionSummary: "Install analytics and basic conversion events so you can see what's working.",
    includedItems: [
      "Install/verify analytics on all pages",
      "Configure core conversion events (form, call, CTA)",
      "Confirm data is flowing correctly",
    ],
    excludedItems: ["Custom dashboards", "Attribution modeling", "Data warehouse work"],
    revisionPolicy: "One verification pass within 7 days of delivery.",
  },
  {
    key: "mobile-layout-fix",
    name: "Mobile Layout Correction",
    state: "PROVEN",
    addressesCategories: ["Brand Experience", "Customer Acquisition"],
    matchHints: ["mobile", "responsive", "phone", "small screen", "layout breaks", "not mobile friendly"],
    minHours: 2,
    maxHours: 5,
    externalCostCents: 0,
    risk: "medium",
    supportBurden: "low",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN],
    maintenancePlanKey: "site-check-care",
    solutionSummary: "Correct the mobile experience on your key pages so it reads and converts on a phone.",
    includedItems: [
      "Fix layout breakage on primary pages (mobile)",
      "Correct tap targets and spacing",
      "Ensure the CTA + contact path work on mobile",
      "Cross-device verification",
    ],
    excludedItems: ["Full responsive redesign", "New page templates", "App development"],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "trust-signal-install",
    name: "Local Trust Signal Upgrade",
    state: "AVAILABLE",
    addressesCategories: ["Customer Retention", "Brand Experience"],
    matchHints: ["reviews", "testimonials", "trust", "social proof", "ratings not shown", "credibility"],
    minHours: 2,
    maxHours: 5,
    externalCostCents: 0,
    risk: "low",
    supportBurden: "low",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN],
    maintenancePlanKey: "site-check-care",
    solutionSummary: "Surface your existing reviews and trust signals where buyers decide.",
    includedItems: [
      "Add a reviews/testimonials section to the homepage",
      "Surface star rating + count near the CTA",
      "Add credibility elements (awards, affiliations) you already have",
    ],
    excludedItems: ["Fabricated reviews", "Review-generation campaigns", "Reputation management retainer"],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "accessibility-quickfix",
    name: "Accessibility Quick Fix",
    state: "AVAILABLE",
    addressesCategories: ["Brand Experience", "Operations"],
    matchHints: ["accessibility", "wcag", "contrast", "alt text", "aria", "screen reader"],
    minHours: 2,
    maxHours: 6,
    externalCostCents: 0,
    risk: "medium",
    supportBurden: "low",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN],
    maintenancePlanKey: "accessibility-care",
    solutionSummary: "Remediate the highest-impact accessibility issues on your primary surface.",
    includedItems: [
      "Fix color-contrast failures on key pages",
      "Add missing alt text on meaningful images",
      "Correct obvious keyboard/focus issues on the CTA + form",
    ],
    excludedItems: ["Full WCAG AA certification", "Ongoing legal compliance guarantee", "PDF remediation at scale"],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "lead-capture-package",
    name: "Lead Capture Optimization",
    state: "PROVEN",
    addressesCategories: ["Customer Acquisition", "Communication", "Automation"],
    matchHints: ["lead capture", "conversion path", "lead flow", "capture rate", "no online booking", "scheduling"],
    minHours: 5,
    maxHours: 10,
    externalCostCents: 0,
    risk: "medium",
    supportBurden: "medium",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN],
    maintenancePlanKey: "lead-flow-care",
    solutionSummary: "Rebuild the path from visitor to lead so more of your existing traffic converts.",
    includedItems: [
      "Reposition CTA + simplify the primary conversion path",
      "Rebuild the lead/contact form and confirm delivery",
      "Add a lightweight scheduling/booking entry point",
      "Add trust signals near the decision point",
      "Post-launch verification across devices",
    ],
    excludedItems: ["Paid ad management", "CRM platform migration", "Full funnel/automation buildout"],
    revisionPolicy: "One round of adjustments within 14 days of delivery.",
  },
  {
    key: "homepage-conversion-sprint",
    name: "Homepage Conversion Sprint",
    state: "AVAILABLE",
    addressesCategories: ["Customer Acquisition", "Brand Experience"],
    matchHints: ["homepage", "hero", "value proposition", "above the fold", "first impression", "bounce"],
    minHours: 6,
    maxHours: 10,
    externalCostCents: 0,
    risk: "medium",
    supportBurden: "medium",
    requiresDiscovery: false,
    accessRequirements: [WEBSITE_ADMIN],
    maintenancePlanKey: "site-check-care",
    solutionSummary: "Focused optimization of your homepage so it states the offer and drives one clear action.",
    includedItems: [
      "Rewrite the hero + primary value statement (from your existing positioning)",
      "Establish one clear primary action",
      "Reorder the page around the buyer's decision",
      "Mobile + trust pass",
      "Post-launch verification",
    ],
    excludedItems: ["Multi-page redesign", "New brand identity", "Custom development"],
    revisionPolicy: "One round of adjustments within 14 days of delivery.",
  },
];

const BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));

/** Only these states may be sold. */
export const SELLABLE_STATES: CapabilityState[] = ["PROVEN", "AVAILABLE", "APPROVED"];

export function capabilityByKey(key: string): Capability | null {
  return BY_KEY.get(key) ?? null;
}

export function isSellable(cap: Capability): boolean {
  return SELLABLE_STATES.includes(cap.state) && !cap.requiresDiscovery;
}

/**
 * Match a finding to the best sellable capability, deterministically.
 * Returns null when nothing sellable applies (→ the engine will NOT productize).
 */
export function matchCapability(finding: { category: string; observation: string; whyItMatters?: string }): Capability | null {
  const hay = `${finding.observation} ${finding.whyItMatters ?? ""}`.toLowerCase();
  // A "no website" observation can never anchor a website fix — you can't repair a
  // CTA/form/layout on a site that doesn't exist. Never match such a finding.
  if (/\bno (owned |functioning )?website\b|no website|without a website|only (a |an )?(google business|facebook|word of mouth)/.test(hay)) return null;
  let best: { cap: Capability; score: number } | null = null;
  for (const cap of CAPABILITIES) {
    if (!isSellable(cap)) continue;
    // A category match alone is NOT enough — that would let the engine invent a
    // fix for an unrelated observation. Require at least one concrete keyword hint.
    let hintScore = 0;
    for (const hint of cap.matchHints) if (hay.includes(hint)) hintScore += 3;
    if (hintScore === 0) continue;
    const score = hintScore + (cap.addressesCategories.includes(finding.category) ? 2 : 0);
    if (!best || score > best.score) best = { cap, score };
  }
  return best?.cap ?? null;
}

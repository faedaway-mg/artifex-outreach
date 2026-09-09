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
  /** Internal capability name — may contain acronyms/jargon (e.g. "Primary CTA Repair").
   *  NEVER shown to a customer as-is; use `customerTitle` for anything customer-facing. */
  name: string;
  /** Plain-language title a normal business owner recognizes — NO acronyms/jargon.
   *  This is the ONLY capability label that may appear in customer-facing copy. */
  customerTitle: string;
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
    customerTitle: "Booking & Contact Button Repair",
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
    solutionSummary: "Move and fix your main booking or contact button so visitors can act without hunting for it.",
    includedItems: [
      "Move the main booking or contact button to the top of the page where visitors see it first",
      "Fix the button when it is broken or sends people to the wrong place",
      "Fix the button so it works on phones",
      "Check everything works on computer and phone after the change goes live",
    ],
    excludedItems: ["Full homepage redesign", "New logo and brand look", "Brand new pages built from scratch"],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "contact-form-repair",
    name: "Contact / Lead Form Repair",
    customerTitle: "Contact Form Repair",
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
    solutionSummary: "Fix and simplify the way people contact you so inquiries actually reach you.",
    includedItems: [
      "Fix the contact form when submissions are failing",
      "Trim the form down to the few fields that really matter",
      "Confirm that submissions land in your inbox",
      "Make sure the form is easy to use on a phone",
    ],
    excludedItems: [
      "Setting up a customer management system (a CRM) to track leads",
      "Automatic follow up emails and marketing tools",
      "Connecting the form to other software you use",
    ],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "metadata-seo-cleanup",
    name: "Metadata & Title Cleanup",
    customerTitle: "Search Listing Cleanup",
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
    solutionSummary: "Clean up the page titles and descriptions so search results and shared links represent you correctly.",
    includedItems: [
      "Fix the titles and descriptions on your main pages",
      "Fix duplicate or leftover placeholder page information that search engines read",
      "Set a sensible preview image and text for when your pages are shared on social media",
    ],
    excludedItems: [
      "A full search marketing campaign to raise your rankings",
      "Writing large amounts of new page content",
      "Getting other websites to link to yours",
    ],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "analytics-install",
    name: "Analytics Visibility Setup",
    customerTitle: "Website Visitor Tracking Setup",
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
    solutionSummary: "Set up visitor tracking and measure the key actions people take so you can see what's working.",
    includedItems: [
      "Set up and confirm visitor tracking on every page",
      "Measure the key actions visitors take (form submissions, phone calls, button clicks)",
      "Confirm the numbers are being recorded correctly",
    ],
    excludedItems: [
      "Custom reporting dashboards",
      "Working out which channels get credit for each sale",
      "Building a central data store for your reports",
    ],
    revisionPolicy: "One verification pass within 7 days of delivery.",
  },
  {
    key: "mobile-layout-fix",
    name: "Mobile Layout Correction",
    customerTitle: "Mobile Website Fix",
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
    solutionSummary: "Fix how your key pages look and work on a phone so they read well and win business on mobile.",
    includedItems: [
      "Fix pages that look broken or jumbled on a phone",
      "Fix buttons and links that are too small to tap and correct crowded spacing",
      "Make sure the main booking or contact button and the contact path work on a phone",
      "Check the pages on different devices and screen sizes",
    ],
    excludedItems: [
      "Rebuilding the whole site to adapt to every screen size",
      "New page designs and templates",
      "Building a phone app",
    ],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "trust-signal-install",
    name: "Local Trust Signal Upgrade",
    customerTitle: "Customer Reviews & Trust Display",
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
    solutionSummary: "Show off the reviews and trust marks you already have, right where buyers make up their minds.",
    includedItems: [
      "Add a customer reviews and testimonials section to the homepage",
      "Show your star rating and number of reviews right next to the main booking or contact button",
      "Add proof you already have, like awards and memberships",
    ],
    excludedItems: [
      "Making up fake reviews",
      "Running campaigns to collect new reviews",
      "An ongoing service to manage your online reputation",
    ],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "accessibility-quickfix",
    name: "Accessibility Quick Fix",
    customerTitle: "Easier to Read & Accessibility Fixes",
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
    solutionSummary: "Fix the accessibility problems on your main pages that shut out the most visitors.",
    includedItems: [
      "Fix color combinations that are hard to read on key pages so text stands out clearly",
      "Add missing text descriptions for images (alt text) so screen readers can describe them",
      "Fix clear problems using the main booking or contact button and the form with a keyboard only",
    ],
    excludedItems: [
      "Full formal accessibility certification",
      "An ongoing promise that you stay within accessibility laws",
      "Making large numbers of PDF documents accessible",
    ],
    revisionPolicy: "One round of adjustments within 7 days of delivery.",
  },
  {
    key: "lead-capture-package",
    name: "Lead Capture Optimization",
    customerTitle: "Turn More Visitors Into Contacts",
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
    solutionSummary: "Rebuild the path from visitor to enquiry so more of the people already visiting your site get in touch.",
    includedItems: [
      "Move the main booking or contact button and simplify the main path visitors take to get in touch",
      "Rebuild the contact form and confirm submissions reach you",
      "Add a simple way for visitors to book or schedule online",
      "Add reviews and trust marks near the point where visitors decide",
      "Check everything works across devices after the changes go live",
    ],
    excludedItems: [
      "Running paid ads for you",
      "Moving your customer records into a new customer management system (a CRM)",
      "Setting up a full marketing system that sends follow-up messages on its own",
    ],
    revisionPolicy: "One round of adjustments within 14 days of delivery.",
  },
  {
    key: "homepage-conversion-sprint",
    name: "Homepage Conversion Sprint",
    customerTitle: "Homepage Clarity Improvements",
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
    solutionSummary: "Focused improvements to your homepage so it clearly states what you offer and points visitors to one clear action.",
    includedItems: [
      "Rewrite the top section of the page and your main sentence about what you offer (using the way you already describe yourself)",
      "Give the page one clear main action for visitors to take",
      "Reorder the page around the way a buyer decides",
      "Check it works on a phone and add reviews and trust marks",
      "Check everything works after the changes go live",
    ],
    excludedItems: [
      "Redesigning several pages",
      "New logo and brand look",
      "Custom features built from scratch",
    ],
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

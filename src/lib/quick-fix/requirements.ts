// ─────────────────────────────────────────────────────────────────────────────
// REQUIREMENTS ENGINE — "What we'll need from you", generated from the offer's
// actual scope and shown BEFORE payment. Principle: MINIMUM REQUIRED ACCESS.
//
// Necessity is explicit (REQUIRED_BEFORE_START / OPTIONAL / ONLY_IF_NEEDED) and
// each item is actionable (platform steps). Access is granted via native
// collaborator invites — never a password. The delivery clock only starts once
// the REQUIRED_BEFORE_START items are received.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { capabilityByKey } from "./capabilities";

export type Necessity = "REQUIRED_BEFORE_START" | "OPTIONAL" | "ONLY_IF_NEEDED";

export interface RequirementItem {
  key: string;
  label: string;
  necessity: Necessity;
  /** Actionable, platform-native steps. */
  steps: string[];
  /** Reassurance: never a password. */
  secure: true;
}

export interface RequirementsChecklist {
  offerId: string;
  items: RequirementItem[];
  /** The blocking acknowledgement the prospect ticks before checkout. */
  acknowledgement: string;
  /** Distinct required-before-start count — what the delivery clock waits on. */
  blockingCount: number;
}

// Actionable, minimum-access templates. Only platforms plausibly present in the
// Acquisition OS lead inventory — we do not build dozens of unused integrations.
const WEBSITE_ADMIN_STEPS = [
  "WordPress: Users → Add New → enter our access email → role Editor → Send invite.",
  "Shopify: Settings → Users and permissions → Add staff → our email → limit to Themes/Online Store.",
  "Webflow: Site settings → Members → Invite → our email → Can edit.",
  "Squarespace: Settings → Permissions → Invite Contributor → our email.",
  "Other platform: add our access email as an editor/collaborator — never share your password.",
];
const ANALYTICS_STEPS = [
  "GA4: Admin → Property Access Management → Add user → our email → Viewer (or Editor if changes are needed).",
  "Google Tag Manager (only if event changes are needed): Admin → User Management → Add → our email.",
];

const TEMPLATE: Record<string, { label: string; necessity: Necessity; steps: string[] }> = {
  "website-admin": { label: "Editor/collaborator access to your website platform", necessity: "REQUIRED_BEFORE_START", steps: WEBSITE_ADMIN_STEPS },
  "analytics-access": { label: "Viewer/editor access to Google Analytics (and Tag Manager if needed)", necessity: "REQUIRED_BEFORE_START", steps: ANALYTICS_STEPS },
};

// Standard optional / only-if-needed items appended to every offer.
const TESTING_EMAIL: RequirementItem = {
  key: "testing-email",
  label: "A testing/contact email to confirm forms deliver correctly",
  necessity: "OPTIONAL",
  steps: ["Reply to your confirmation email with an address we can use for a test submission."],
  secure: true,
};
const PAGE_APPROVAL: RequirementItem = {
  key: "page-approval",
  label: "Confirmation of the exact page(s) we may modify",
  necessity: "REQUIRED_BEFORE_START",
  steps: ["Confirm the page URL(s) in scope so we only touch what you approved."],
  secure: true,
};
const DNS_ACCESS: RequirementItem = {
  key: "dns-access",
  label: "DNS access — only if a change turns out to require it",
  necessity: "ONLY_IF_NEEDED",
  steps: ["We'll request specific DNS records only if strictly necessary, and explain exactly why first."],
  secure: true,
};

export function buildRequirements(offer: QuickFixOffer): RequirementsChecklist {
  const items: RequirementItem[] = [];
  const seen = new Set<string>();
  for (const capKey of offer.capabilityKeys) {
    const cap = capabilityByKey(capKey);
    if (!cap) continue;
    for (const req of cap.accessRequirements) {
      if (seen.has(req.key)) continue;
      seen.add(req.key);
      const tpl = TEMPLATE[req.key] ?? { label: req.label, necessity: "REQUIRED_BEFORE_START" as Necessity, steps: [req.howToGrant] };
      items.push({ key: req.key, label: tpl.label, necessity: tpl.necessity, steps: tpl.steps, secure: true });
    }
  }
  // Page approval is required whenever we touch a website; testing email is optional; DNS only if needed.
  if (offer.capabilityKeys.some((k) => capabilityByKey(k)?.accessRequirements.some((a) => a.key === "website-admin"))) {
    if (!seen.has("page-approval")) items.push(PAGE_APPROVAL);
    items.push(TESTING_EMAIL);
    items.push(DNS_ACCESS);
  }

  const blockingCount = items.filter((i) => i.necessity === "REQUIRED_BEFORE_START").length;
  return {
    offerId: offer.offerId,
    items,
    acknowledgement: "I understand the turnaround begins after the required access and information are provided.",
    blockingCount,
  };
}

// ── Delivery clock ─────────────────────────────────────────────────────────────
export function deliveryWindowHours(offer: QuickFixOffer): number {
  const w = offer.scope.deliveryWindow;
  if (/24 hours/.test(w)) return 24;
  if (/48 hours/.test(w)) return 48;
  return 120; // 5 business days
}

export interface DeliveryClock {
  purchasedAt: string | null;
  requirementsReceivedAt: string | null;
  fulfillmentClockStartedAt: string | null;
  targetDeliveryAt: string | null;
}

/**
 * Compute the delivery clock. The clock STARTS at requirementsReceivedAt, never
 * at purchase — so an outstanding blocker never runs down the customer's window.
 */
export function computeDeliveryClock(args: {
  offer: QuickFixOffer;
  purchasedAt: string | null;
  requirementsReceivedAt: string | null;
}): DeliveryClock {
  const hours = deliveryWindowHours(args.offer);
  const started = args.requirementsReceivedAt;
  const target = started ? new Date(new Date(started).getTime() + hours * 3600_000).toISOString() : null;
  return {
    purchasedAt: args.purchasedAt,
    requirementsReceivedAt: args.requirementsReceivedAt,
    fulfillmentClockStartedAt: started,
    targetDeliveryAt: target,
  };
}

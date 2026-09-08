// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER LIFECYCLE + ANALYTICS TAXONOMY.
//
// A verified purchase turns a PROSPECT into a CUSTOMER and stops cold outreach —
// customers are never treated as untouched prospects again. The analytics event
// names below are the canonical funnel vocabulary; the app records them via the
// existing audit log (action = event). We never fabricate events the stack can't
// actually observe (e.g. email-open only if the provider reports it).
// ─────────────────────────────────────────────────────────────────────────────

export type FirstPurchaseType = "REPAIR" | "FIX_SCAN";

export interface CustomerRecord {
  leadId: string;
  email: string;
  firstPurchaseAt: string;
  firstPurchaseType: FirstPurchaseType;
  lifetimeRevenueCents: number;
  offersPurchased: string[]; // offerIds
  maintenancePlanKey: string | null;
  lastDeliveredAt: string | null;
  nextOpportunity: string | null;
  referralSource: string | null;
}

export interface LifecycleTransition {
  becomesCustomer: boolean;
  stopColdOutreach: boolean;
  reason: string;
}

/** Decide the lifecycle transition for a verified purchase. */
export function onVerifiedPurchase(existing: CustomerRecord | null, args: { leadId: string; email: string; offerId: string; amountCents: number; at: string; maintenancePlanKey: string | null; purchaseType?: FirstPurchaseType }): { record: CustomerRecord; transition: LifecycleTransition } {
  if (!existing) {
    return {
      record: {
        leadId: args.leadId,
        email: args.email,
        firstPurchaseAt: args.at,
        firstPurchaseType: args.purchaseType ?? "REPAIR",
        lifetimeRevenueCents: args.amountCents,
        offersPurchased: [args.offerId],
        maintenancePlanKey: args.maintenancePlanKey,
        lastDeliveredAt: null,
        nextOpportunity: null,
        referralSource: null,
      },
      transition: { becomesCustomer: true, stopColdOutreach: true, reason: "first verified purchase → prospect becomes customer" },
    };
  }
  const offersPurchased = existing.offersPurchased.includes(args.offerId) ? existing.offersPurchased : [...existing.offersPurchased, args.offerId];
  return {
    record: {
      ...existing,
      lifetimeRevenueCents: existing.lifetimeRevenueCents + args.amountCents,
      offersPurchased,
      maintenancePlanKey: args.maintenancePlanKey ?? existing.maintenancePlanKey,
    },
    transition: { becomesCustomer: false, stopColdOutreach: true, reason: "repeat purchase by existing customer" },
  };
}

// ── Canonical funnel event names (recorded via appendAudit action=<name>) ──────
export const FUNNEL_EVENTS = {
  emailSent: "quickfix.email_sent",
  emailOpened: "quickfix.email_opened", // only if provider reports it
  pdfViewed: "quickfix.pdf_viewed",
  diagnosticVideoViewed: "quickfix.diagnostic_video_viewed",
  offerPageViewed: "quickfix.offer_page_viewed",
  trustVideoStarted: "quickfix.trust_video_started",
  trustVideoCompleted: "quickfix.trust_video_completed",
  checkoutClicked: "quickfix.checkout_clicked",
  termsAccepted: "quickfix.terms_accepted",
  checkoutStarted: "quickfix.checkout_started",
  purchaseCompleted: "quickfix.purchase_completed",
  intakeStarted: "quickfix.intake_started",
  intakeCompleted: "quickfix.intake_completed",
  jobStarted: "quickfix.job_started",
  jobDelivered: "quickfix.job_delivered",
  maintenanceAccepted: "quickfix.maintenance_accepted",
  callBooked: "quickfix.call_booked",
  referralCreated: "quickfix.referral_created",
  // Fix Scan ($99 diagnostic) funnel
  fixScanOffered: "quickfix.fix_scan_offered",
  fixScanViewed: "quickfix.fix_scan_viewed",
  fixScanCheckoutStarted: "quickfix.fix_scan_checkout_started",
  fixScanPurchased: "quickfix.fix_scan_purchased",
  fixScanDelivered: "quickfix.fix_scan_delivered",
  creditEligible: "quickfix.credit_eligible",
  creditUsed: "quickfix.credit_used",
  creditExpired: "quickfix.credit_expired",
  repairAfterScan: "quickfix.repair_after_scan",
} as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS];

/** Referral lineage prepared post-delivery (tracked, not auto-sent). */
export interface ReferralRecord {
  referredByCustomerId: string; // leadId of the referring customer
  referralSource: string;
  resultingLeadId: string | null;
  resultingRevenueCents: number;
  createdAt: string;
}

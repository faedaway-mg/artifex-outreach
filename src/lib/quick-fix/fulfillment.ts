// ─────────────────────────────────────────────────────────────────────────────
// FULFILLMENT — job state machine + post-purchase intake.
//
// A validated Stripe payment (webhook, not browser redirect) creates a job in
// PAID. The job then walks a bounded lifecycle. Intake asks ONLY for the access a
// bundled capability actually needs, and NEVER asks for a password — access is
// granted via each platform's native collaborator invite.
// ─────────────────────────────────────────────────────────────────────────────
import type { JobState, QuickFixOffer } from "./types";
import { capabilityByKey, type AccessRequirement } from "./capabilities";

// Allowed forward transitions. Refund/cancel are reachable from most live states.
const TRANSITIONS: Record<JobState, JobState[]> = {
  PAID: ["WAITING_FOR_CUSTOMER_INPUT", "READY_FOR_FULFILLMENT", "REFUNDED", "CANCELED"],
  WAITING_FOR_CUSTOMER_INPUT: ["READY_FOR_FULFILLMENT", "REFUNDED", "CANCELED"],
  READY_FOR_FULFILLMENT: ["IN_PROGRESS", "REFUNDED", "CANCELED"],
  IN_PROGRESS: ["QA", "REFUNDED", "CANCELED"],
  QA: ["DELIVERED", "IN_PROGRESS", "REFUNDED", "CANCELED"],
  DELIVERED: ["COMPLETE", "IN_PROGRESS"],
  COMPLETE: [],
  REFUNDED: [],
  CANCELED: [],
};

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** The state a job enters right after a validated payment, given whether intake is needed. */
export function initialJobStateAfterPayment(needsIntake: boolean): JobState {
  return needsIntake ? "WAITING_FOR_CUSTOMER_INPUT" : "READY_FOR_FULFILLMENT";
}

export interface IntakeItem {
  key: string;
  label: string;
  howToGrant: string;
  /** never store or request a password */
  secure: true;
}

export interface IntakeChecklist {
  offerId: string;
  items: IntakeItem[];
  /** Explicit reassurance shown to the customer. */
  securityNote: string;
}

const SECURITY_NOTE =
  "We never ask for your password. Grant access using each platform's built-in collaborator/editor invite — you can revoke it any time after delivery.";

/** Build the intake checklist from the offer's bundled capabilities (deduped). */
export function buildIntakeChecklist(offer: QuickFixOffer): IntakeChecklist {
  const seen = new Set<string>();
  const items: IntakeItem[] = [];
  for (const key of offer.capabilityKeys) {
    const cap = capabilityByKey(key);
    if (!cap) continue;
    for (const req of cap.accessRequirements as AccessRequirement[]) {
      if (seen.has(req.key)) continue;
      seen.add(req.key);
      items.push({ key: req.key, label: req.label, howToGrant: req.howToGrant, secure: true });
    }
  }
  return { offerId: offer.offerId, items, securityNote: SECURITY_NOTE };
}

export function needsIntake(offer: QuickFixOffer): boolean {
  return buildIntakeChecklist(offer).items.length > 0;
}

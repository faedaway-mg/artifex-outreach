// ─────────────────────────────────────────────────────────────────────────────
// Monthly retainer support — DRAFT/CONFIG ONLY. Activation is deliberately blocked.
//
// Gate-1 reconciliation found NO approved recurring offering: the agreement's
// `monthlyPartnershipCents` is an optional, operator-typed figure and the template
// presents ongoing partnership as an OPTION (§11), with no defined cadence, start
// trigger, cancellation policy, minimum term, or automatic-charge consent. Per the
// milestone's rule, recurring billing must NOT be activated while those commercial
// terms are missing — we invent none of them. This module represents only what is
// safe to draft and reports exactly which decisions are missing.
//
// No Stripe Subscriptions activation code exists here on purpose.
// ─────────────────────────────────────────────────────────────────────────────
import type { AgreementContentSnapshot } from "../types";

/** The decisions that MUST be established (by the operator) before any activation. */
export const REQUIRED_RETAINER_DECISIONS = [
  "cadence (e.g. monthly on the Nth)",
  "start trigger (when the first charge occurs)",
  "cancellation policy (notice period; the agreement §11 says 30 days — confirm)",
  "minimum term (if any)",
  "automatic-charge consent (explicit client authorization to store + charge a card)",
] as const;

export interface RetainerReadiness {
  /** True only if the agreement actually carries a monthly figure to draft from. */
  present: boolean;
  monthlyAmountCents: number | null;
  currency: string;
  /** ALWAYS true in M2 — terms are undefined; activation is not permitted. */
  activationBlocked: true;
  /** The exact decisions the operator must supply before activation is designed. */
  missingDecisions: string[];
  note: string;
}

export function retainerReadiness(snapshot: Pick<AgreementContentSnapshot, "monthlyPartnershipCents" | "currency">): RetainerReadiness {
  const cents = snapshot.monthlyPartnershipCents;
  const present = typeof cents === "number" && cents > 0;
  return {
    present,
    monthlyAmountCents: present ? cents! : null,
    currency: snapshot.currency,
    activationBlocked: true,
    missingDecisions: [...REQUIRED_RETAINER_DECISIONS],
    note: present
      ? "A monthly figure exists, but recurring billing is NOT configured: the cadence, start trigger, cancellation policy, minimum term, and automatic-charge consent are undefined. Activation is blocked pending operator decisions."
      : "No monthly retainer on this agreement. Nothing to draft.",
  };
}

export class RetainerActivationBlockedError extends Error {
  constructor() {
    super("Retainer activation is blocked: recurring commercial terms are not established. No subscription may be created.");
    this.name = "RetainerActivationBlockedError";
  }
}

/** Any future activation path must call this until terms + a design exist. */
export function assertRetainerActivationBlocked(): never {
  throw new RetainerActivationBlockedError();
}

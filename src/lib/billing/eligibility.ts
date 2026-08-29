// ─────────────────────────────────────────────────────────────────────────────
// Billing eligibility state machine (Gate 10) + live-payment firewall (Gate 3).
//
// Eligibility is an EXPLICIT DERIVED STATE, never an incidental side effect of
// `status==="signed"`. `evaluateBillingEligibility` folds every safety condition into
// exactly one state; `assertBillingAllowed` is the firewall called at EVERY billing
// boundary (deposit creation, invoice create/finalize, PaymentIntent, checkout,
// subscription, retry, reconciliation, manual action).
//
// The core guarantee: a TEST-mode agreement (or one signed via a test SignWell doc)
// can only ever reach ELIGIBLE_TEST_PAYMENT — which the firewall permits solely against
// a Stripe TEST key. ELIGIBLE_LIVE_PAYMENT requires production mode + valid owner
// approval + exact-document match + all signers complete + durable retention + explicit
// live authorization, all at once. Fail closed.
// ─────────────────────────────────────────────────────────────────────────────
import type { EsignMode } from "../esign/mode";
import type { StripeMode } from "../agreement/approval";

export type EligibilityState =
  | "BLOCKED_TEST_AGREEMENT"
  | "BLOCKED_UNSIGNED"
  | "BLOCKED_PARTIAL_SIGNATURE"
  | "BLOCKED_APPROVAL_MISSING"
  | "BLOCKED_DOCUMENT_MISMATCH"
  | "BLOCKED_RECIPIENT_MISMATCH"
  | "BLOCKED_RETENTION_PENDING"
  | "BLOCKED_RETENTION_FAILED"
  | "BLOCKED_MODE_MISMATCH"
  | "BLOCKED_AMOUNT_MISMATCH"
  | "BLOCKED_LIFECYCLE"
  | "BLOCKED_LIVE_AUTH_MISSING"
  | "ELIGIBLE_TEST_PAYMENT"
  | "ELIGIBLE_LIVE_PAYMENT"
  | "PAID"
  | "CANCELLED";

export interface EligibilityContext {
  /** Persisted signing mode of the agreement (server-derived, immutable after send). */
  esignMode: EsignMode;
  /** Agreement lifecycle status. */
  agreementStatus: "draft" | "generated" | "approved" | "sent" | "viewed" | "signed" | "declined" | "voided";
  /** True only when the terminal document_completed event (ALL signers) was processed. */
  allRequiredSignersComplete: boolean;
  /** A bound, valid owner-approval record exists (not revoked/expired, digest intact). */
  approvalPresentAndValid: boolean;
  /** The current agreement/PDF binding still matches the approved digest (no drift). */
  documentMatchesApproval: boolean;
  /** Recipients still match the approved recipients (order/role/email). */
  recipientsMatchApproval: boolean;
  /** For production: recipients passed the production recipient policy. */
  recipientsPolicyOk: boolean;
  /** The SignWell doc's test_mode agrees with esignMode (checked at send + webhook). */
  modeConsistent: boolean;
  /** Retention outcome for the signed PDF + audit certificate. */
  retention: "not-required" | "pending" | "failed" | "retained";
  /** Deposit amount + currency to be charged match the approved amount + currency. */
  amountMatchesApproval: boolean;
  /** Agreement revoked / superseded / expired / declined / voided. */
  lifecycleTerminatedReason: string | null;
  /** Explicit, separate owner authorization to take a LIVE payment for this agreement. */
  ownerLivePaymentAuthorized: boolean;
  /** Already collected. */
  alreadyPaid: boolean;
}

export interface EligibilityResult {
  state: EligibilityState;
  /** Human-readable, operator-facing reason for the current state. */
  reason: string;
}

/**
 * Fold the context into exactly one eligibility state. Order matters: hard terminal and
 * mode conditions first, then approval/document/recipient integrity, then completion,
 * then retention, then the final test-vs-live split. Fail closed.
 */
export function evaluateBillingEligibility(ctx: EligibilityContext): EligibilityResult {
  if (ctx.alreadyPaid) return { state: "PAID", reason: "Deposit already collected." };
  if (ctx.lifecycleTerminatedReason) return { state: "CANCELLED", reason: `Agreement not billable: ${ctx.lifecycleTerminatedReason}.` };

  // Mode integrity comes first — a mode disagreement is never billable in any direction.
  if (!ctx.modeConsistent) return { state: "BLOCKED_MODE_MISMATCH", reason: "SignWell test_mode disagrees with the persisted agreement mode." };

  // Completion gate — must be signed by ALL required signers (document_completed).
  if (ctx.agreementStatus !== "signed") {
    return { state: "BLOCKED_UNSIGNED", reason: `Agreement is '${ctx.agreementStatus}', not signed.` };
  }
  if (!ctx.allRequiredSignersComplete) {
    return { state: "BLOCKED_PARTIAL_SIGNATURE", reason: "Not all required signers have completed (no document_completed)." };
  }

  // Approval + exact-document integrity.
  if (!ctx.approvalPresentAndValid) return { state: "BLOCKED_APPROVAL_MISSING", reason: "No valid, bound owner approval." };
  if (!ctx.documentMatchesApproval) return { state: "BLOCKED_DOCUMENT_MISMATCH", reason: "The completed document/terms drifted from the approved binding." };
  if (!ctx.recipientsMatchApproval) return { state: "BLOCKED_RECIPIENT_MISMATCH", reason: "Recipients differ from the approved recipients." };
  if (!ctx.amountMatchesApproval) return { state: "BLOCKED_AMOUNT_MISMATCH", reason: "Deposit amount/currency differs from the approved amount." };

  // TEST agreements can never proceed past here to live — they are test-eligible only.
  if (ctx.esignMode === "test") {
    // A test agreement is eligible for TEST payment once signed+matched. Retention is
    // not a hard gate in test, but mode/approval integrity still hold.
    return { state: "ELIGIBLE_TEST_PAYMENT", reason: "Test agreement — eligible for TEST payment only." };
  }

  // ── PRODUCTION path from here ──
  if (!ctx.recipientsPolicyOk) return { state: "BLOCKED_RECIPIENT_MISMATCH", reason: "Production recipients failed the recipient policy." };
  if (ctx.retention === "pending") return { state: "BLOCKED_RETENTION_PENDING", reason: "Signed PDF / audit certificate retention is still pending." };
  if (ctx.retention === "failed") return { state: "BLOCKED_RETENTION_FAILED", reason: "Signed PDF / audit certificate retention failed." };
  if (ctx.retention === "not-required") return { state: "BLOCKED_RETENTION_PENDING", reason: "Production requires signed PDF + certificate retention before payment." };
  if (!ctx.ownerLivePaymentAuthorized) return { state: "BLOCKED_LIVE_AUTH_MISSING", reason: "Explicit owner live-payment authorization is required." };

  return { state: "ELIGIBLE_LIVE_PAYMENT", reason: "Production agreement — all live-payment gates satisfied." };
}

export class BillingFirewallError extends Error {
  readonly state: EligibilityState;
  readonly intendedMode: StripeMode;
  constructor(message: string, state: EligibilityState, intendedMode: StripeMode) {
    super(message);
    this.name = "BillingFirewallError";
    this.state = state;
    this.intendedMode = intendedMode;
  }
}

export interface FirewallInput {
  /** The Stripe environment the intended action would run against (from the key). */
  intendedStripeMode: StripeMode;
  /** The agreement's persisted signing mode. */
  esignMode: EsignMode;
  /** The evaluated eligibility. */
  eligibility: EligibilityResult;
  /** Named billing boundary (for the error message / audit). */
  boundary: string;
}

/**
 * The firewall. Refuses any billing action that would:
 *  - run a TEST agreement against a LIVE Stripe key (or vice-versa),
 *  - take a LIVE payment for anything not ELIGIBLE_LIVE_PAYMENT,
 *  - take any payment when eligibility is a BLOCKED_* / CANCELLED / PAID state.
 * Returns the permitted Stripe mode on success; throws BillingFirewallError otherwise.
 */
export function assertBillingAllowed(input: FirewallInput): { allowedMode: StripeMode } {
  const { intendedStripeMode: mode, esignMode, eligibility, boundary } = input;
  const fail = (msg: string) => {
    throw new BillingFirewallError(`[firewall:${boundary}] ${msg} (state=${eligibility.state}, esignMode=${esignMode}, intended=${mode})`, eligibility.state, mode);
  };

  // 1) Mode/key alignment — a test agreement may NEVER touch a live key; a production
  //    agreement may NEVER be charged on a test key.
  if (esignMode === "test" && mode === "live") fail("test agreement cannot use a LIVE Stripe key");
  if (esignMode === "production" && mode === "test") fail("production agreement cannot be charged on a TEST Stripe key");

  // 2) Eligibility must be an ELIGIBLE_* state matching the mode.
  if (esignMode === "test") {
    if (eligibility.state !== "ELIGIBLE_TEST_PAYMENT") fail(`test agreement not eligible: ${eligibility.reason}`);
    return { allowedMode: "test" };
  }
  // production
  if (eligibility.state !== "ELIGIBLE_LIVE_PAYMENT") fail(`production agreement not eligible for live payment: ${eligibility.reason}`);
  return { allowedMode: "live" };
}

/** Classify a Stripe secret key string as test/live without logging it. */
export function stripeModeOfKey(key: string | undefined | null): StripeMode | null {
  if (!key) return null;
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return null;
}

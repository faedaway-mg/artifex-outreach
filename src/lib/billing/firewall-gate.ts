// ─────────────────────────────────────────────────────────────────────────────
// Firewall integration (Gate 3) — ties a persisted Agreement to the eligibility state
// machine + live-payment firewall, resolving the INTENDED Stripe mode from the issuer's
// configured key. Call `assertAgreementBillingAllowed` at EVERY billing boundary before
// any Stripe object is created. Fail closed: a missing/unknown key blocks.
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement } from "../types";
import type { AgreementApproval, ApprovalBinding, StripeMode } from "../agreement/approval";
import { approvalValidReasons, bindingDriftReasons } from "../agreement/approval";
import { resolveStripeKeyForIssuer } from "../payments/stripe-invoice";
import { evaluateBillingEligibility, assertBillingAllowed, stripeModeOfKey, BillingFirewallError, type EligibilityContext, type EligibilityResult } from "./eligibility";
import type { EsignMode } from "../esign/mode";

/** null legacy mode is fail-closed to "test" (can never unlock live payment). */
export function esignModeOf(agreement: Pick<Agreement, "esignMode">): EsignMode {
  return agreement.esignMode === "production" ? "production" : "test";
}

export interface ProductionEvidence {
  /** The bound owner approval for this agreement version (if any). */
  approval?: AgreementApproval | null;
  /** The binding recomputed from the CURRENT agreement + intended recipients/modes. */
  currentBinding?: ApprovalBinding | null;
  /** Retention outcome for the signed PDF + audit certificate. */
  retention?: EligibilityContext["retention"];
  /** Production recipients passed the recipient policy. */
  recipientsPolicyOk?: boolean;
  /** Explicit, separate owner authorization to take a LIVE payment. */
  ownerLivePaymentAuthorized?: boolean;
  /** SignWell test_mode agreed with the persisted mode (checked at webhook). */
  modeConsistent?: boolean;
  /** Deposit amount + currency to charge match the approved amount. */
  amountMatchesApproval?: boolean;
  /** Already collected. */
  alreadyPaid?: boolean;
  nowIso: string;
}

/** Build the eligibility context from an agreement + (production) evidence. */
export function agreementEligibilityContext(agreement: Agreement, ev: ProductionEvidence): EligibilityContext {
  const mode = esignModeOf(agreement);
  const lifecycleTerminatedReason =
    agreement.supersededById ? "superseded" : agreement.status === "declined" ? "declined" : agreement.status === "voided" ? "voided" : null;

  // Production binding integrity, derived from the approval + current binding.
  const approvalValid = ev.approval != null && approvalValidReasons(ev.approval, ev.nowIso).length === 0;
  const documentMatches =
    ev.approval != null && ev.currentBinding != null && bindingDriftReasons(ev.approval.binding, ev.currentBinding).length === 0;
  const recipientsMatch =
    ev.approval != null && ev.currentBinding != null &&
    JSON.stringify(ev.approval.binding.recipients) === JSON.stringify(ev.currentBinding.recipients);

  return {
    esignMode: mode,
    agreementStatus: agreement.status,
    // Our SignWell webhook only sets status=signed on document_completed (all signers).
    allRequiredSignersComplete: agreement.status === "signed",
    approvalPresentAndValid: approvalValid,
    documentMatchesApproval: documentMatches,
    recipientsMatchApproval: recipientsMatch,
    recipientsPolicyOk: ev.recipientsPolicyOk ?? false,
    modeConsistent: ev.modeConsistent ?? true,
    retention: ev.retention ?? "not-required",
    amountMatchesApproval: ev.amountMatchesApproval ?? true,
    lifecycleTerminatedReason,
    ownerLivePaymentAuthorized: ev.ownerLivePaymentAuthorized ?? false,
    alreadyPaid: ev.alreadyPaid ?? false,
  };
}

export interface FirewallDecision {
  allowedMode: StripeMode;
  eligibility: EligibilityResult;
}

/**
 * The single call every billing boundary makes. Resolves the issuer's key → intended
 * Stripe mode, evaluates eligibility, and runs the firewall. Throws BillingFirewallError
 * on any refusal. `nowIso`/production evidence are optional for the test path.
 */
export function assertAgreementBillingAllowed(
  agreement: Agreement,
  issuerId: string,
  boundary: string,
  evidence: ProductionEvidence,
): FirewallDecision {
  const key = resolveStripeKeyForIssuer(issuerId);
  const intended = key.ok ? stripeModeOfKey(key.key) : null;
  const eligibility = evaluateBillingEligibility(agreementEligibilityContext(agreement, evidence));
  if (intended == null) {
    // Unknown/missing/unrecognized key → cannot classify → fail closed.
    throw new BillingFirewallError(
      `[firewall:${boundary}] cannot classify Stripe key for issuer '${issuerId}' (${key.ok ? "unrecognized key prefix" : key.error}) — refusing (state=${eligibility.state})`,
      eligibility.state,
      esignModeOf(agreement) === "production" ? "live" : "test",
    );
  }
  const { allowedMode } = assertBillingAllowed({ intendedStripeMode: intended, esignMode: esignModeOf(agreement), eligibility, boundary });
  return { allowedMode, eligibility };
}

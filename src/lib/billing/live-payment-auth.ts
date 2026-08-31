// ─────────────────────────────────────────────────────────────────────────────
// Live-payment authorization (Gate 11). Signing completion + artifact retention do NOT
// authorize payment. This is a SEPARATE, explicit, one-time, version-bound authorization.
// It can never exist for a TEST agreement, requires everything-but-the-authorization to
// already pass (eligibility == BLOCKED_LIVE_AUTH_MISSING), and is invalidated by drift.
// The billing adapter re-checks the full firewall immediately before Stripe.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getAgreement, getAgreementApproval, signedArtifactsForAgreement,
  hasLivePaymentAuthorization, insertLivePaymentAuthorization,
} from "../repo";
import { nowIso } from "../store";
import { esignModeOf, agreementEligibilityContext } from "./firewall-gate";
import { evaluateBillingEligibility } from "./eligibility";
import { retentionStatus } from "./retention";
import { approvalDigest, bindingDriftReasons, buildApprovalBinding } from "../agreement/approval";
import { closingCan } from "./authz";
import type { Role } from "../operators/roles";

export interface AuthorizeResult {
  ok: boolean;
  authorizationId?: string;
  blocked?: boolean;
  reason?: string;
}

export interface AuthorizeInput {
  agreementId: string;
  actor: string;
  actorRole: Role;
  /** The exact amount + currency the operator is authorizing (must match the approval). */
  amountCents: number;
  currency: string;
}

export async function authorizeLivePayment(input: AuthorizeInput): Promise<AuthorizeResult> {
  if (!closingCan(input.actorRole, "issueInvoice")) {
    return { ok: false, blocked: true, reason: `Role '${input.actorRole}' cannot authorize payment.` };
  }
  const agreement = await getAgreement(input.agreementId);
  if (!agreement) return { ok: false, blocked: true, reason: "Agreement not found." };
  if (esignModeOf(agreement) !== "production") {
    return { ok: false, blocked: true, reason: "Live-payment authorization cannot exist for a TEST agreement." };
  }

  const approval = await getAgreementApproval(agreement.id, agreement.version);
  if (!approval) return { ok: false, blocked: true, reason: "No valid owner approval to authorize against." };

  // Amount + currency must match the approved deposit.
  if (input.amountCents !== approval.binding.depositAmountCents) return { ok: false, blocked: true, reason: "Amount differs from the approved deposit." };
  if (input.currency.toLowerCase() !== approval.binding.currency.toLowerCase()) return { ok: false, blocked: true, reason: "Currency differs from the approved currency." };

  // Everything EXCEPT the live authorization itself must already pass → BLOCKED_LIVE_AUTH_MISSING.
  const artifacts = await signedArtifactsForAgreement(agreement.id);
  const currentBinding = buildApprovalBinding(agreement, {
    providerSignerEmail: approval.binding.providerSignerEmail, clientEmail: approval.binding.clientEmail,
    esignMode: "production", stripeMode: approval.binding.stripeMode, unsignedPdfSha256: approval.binding.unsignedPdfSha256, expiresAt: approval.binding.expiresAt,
  });
  // Drift guard: the current agreement must still match the approval.
  if (bindingDriftReasons(approval.binding, currentBinding).length > 0) return { ok: false, blocked: true, reason: "Agreement drifted from the approval; a new approval is required." };

  const elig = evaluateBillingEligibility(agreementEligibilityContext(agreement, {
    approval, currentBinding, retention: retentionStatus(artifacts, agreement),
    recipientsPolicyOk: true, ownerLivePaymentAuthorized: false, amountMatchesApproval: true, modeConsistent: true, nowIso: nowIso(),
  }));
  if (elig.state !== "BLOCKED_LIVE_AUTH_MISSING") {
    return { ok: false, blocked: true, reason: `Not ready for live authorization: ${elig.reason} (${elig.state}).` };
  }

  // Idempotent: one authorization per agreement (version-bound).
  if (await hasLivePaymentAuthorization(agreement.id)) {
    return { ok: true, reason: "Authorization already exists (idempotent)." };
  }
  const rec = await insertLivePaymentAuthorization({
    agreementId: agreement.id, agreementVersion: agreement.version, approvalDigest: approvalDigest(approval.binding),
    authorizedBy: input.actor, authorizedAt: nowIso(), revokedAt: null,
  });
  return { ok: true, authorizationId: rec.id };
}

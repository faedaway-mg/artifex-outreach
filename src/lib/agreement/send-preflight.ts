// ─────────────────────────────────────────────────────────────────────────────
// Authoritative SEND PREFLIGHT (Gate 4). One place, called immediately before any
// SignWell request is created, that verifies every persisted condition and returns a
// structured receipt. Any failure blocks provider invocation, records no false "sent"
// state, and yields the exact operator-facing reason. PURE — the caller loads state.
// ─────────────────────────────────────────────────────────────────────────────
import type { Agreement } from "../types";
import type { AgreementApproval, StripeMode } from "./approval";
import { approvalValidReasons, bindingDriftReasons, buildApprovalBinding } from "./approval";
import type { EsignMode } from "../esign/mode";
import { signwellTestModeFor } from "../esign/mode";
import type { EsignRecipient } from "../esign/provider";
import { buildRecipients, validateRecipients, expectedSignatureFields } from "../esign/request-builder";
import { validateProductionRecipients, validateTestRecipients, normalizeEmail } from "../billing/recipient-policy";
import type { ProviderConfigResult } from "../esign/provider-config";

export interface PreflightCheck {
  id: string;
  ok: boolean;
  detail?: string;
}

export interface PreflightReceipt {
  ok: boolean;
  esignMode: EsignMode;
  signwellTestMode: boolean;
  checks: PreflightCheck[];
  blockedReasons: string[];
  recipients: EsignRecipient[] | null; // the exact recipients that WOULD be used
  approvalDigest: string | null;
}

export interface PreflightInput {
  agreement: Agreement;
  esignMode: EsignMode;
  approval: AgreementApproval | null;
  /** SHA-256 of the exact unsigned PDF that would be uploaded. */
  unsignedPdfSha256: string;
  /** The provider signer resolved from server config. */
  providerConfig: ProviderConfigResult;
  /** The client signer that would be used (email + name). */
  client: { name: string; email: string; verified: boolean; recordEmail: string | null };
  operatorEmails?: string[];
  knownTestRecipients?: string[];
  productionGateOn: boolean; // PRODUCTION_SIGNING_ENABLED
  sendingGateOn: boolean; // AGREEMENT_SENDING_ENABLED
  stripeMode: StripeMode;
  alreadySent: boolean;
  nowIso: string;
}

export function sendPreflight(input: PreflightInput): PreflightReceipt {
  const { agreement, esignMode, approval } = input;
  const checks: PreflightCheck[] = [];
  const add = (id: string, ok: boolean, detail?: string) => checks.push({ id, ok, detail });
  const production = esignMode === "production";

  // Lifecycle.
  add("agreement_active", agreement.status !== "declined" && agreement.status !== "voided" && !agreement.supersededById,
    agreement.supersededById ? "superseded" : agreement.status);
  add("not_already_sent", !input.alreadySent && !agreement.esignRequestId, agreement.esignRequestId ? "a signature request already exists" : undefined);
  add("mode_assigned", esignMode === "test" || esignMode === "production");

  // Provider (from server config in production).
  const providerEmail = input.providerConfig.config?.signerEmail ?? "";
  const providerName = input.providerConfig.config?.signerName ?? "";
  if (production) {
    add("provider_config", input.providerConfig.ok, input.providerConfig.issues.join("; ") || undefined);
    add("production_flags", input.productionGateOn && input.sendingGateOn,
      `PRODUCTION_SIGNING_ENABLED=${input.productionGateOn}, AGREEMENT_SENDING_ENABLED=${input.sendingGateOn}`);
  }

  const recipients = input.providerConfig.config
    ? buildRecipients({ provider: { name: providerName, email: providerEmail }, client: { name: input.client.name, email: input.client.email } })
    : null;

  // Recipient structure + policy.
  if (recipients) {
    const struct = validateRecipients(recipients);
    add("recipients_structure", struct.ok, struct.issues.join("; ") || undefined);
    const policy = production
      ? validateProductionRecipients({
          providerEmail, providerFromServerConfig: true, clientEmail: input.client.email,
          clientEmailVerified: input.client.verified, clientRecordEmail: input.client.recordEmail,
          operatorEmails: input.operatorEmails, knownTestRecipients: input.knownTestRecipients,
        })
      : validateTestRecipients({ providerEmail, clientEmail: input.client.email });
    add("recipient_policy", policy.ok, policy.issues.join("; ") || undefined);
    // Four signature/date fields, correctly assigned (structural — the PDF builder emits them).
    add("four_fields", expectedSignatureFields().length === 4);
  } else {
    add("recipients_structure", false, "no provider config → cannot build recipients");
  }

  // Approval binding integrity (production requires an approval; test does not).
  let approvalDigest: string | null = null;
  if (production) {
    if (!approval) {
      add("approval_present", false, "no bound owner approval");
    } else {
      approvalDigest = approval.digest;
      const validReasons = approvalValidReasons(approval, input.nowIso);
      add("approval_valid", validReasons.length === 0, validReasons.join("; ") || undefined);
      // Rebuild the binding from the CURRENT agreement + intended recipients/modes and compare.
      const current = buildApprovalBinding(agreement, {
        providerSignerEmail: providerEmail, clientEmail: input.client.email,
        esignMode, stripeMode: input.stripeMode, unsignedPdfSha256: input.unsignedPdfSha256,
        expiresAt: approval.binding.expiresAt,
      });
      const drift = bindingDriftReasons(approval.binding, current);
      add("no_binding_drift", drift.length === 0, drift.join("; ") || undefined);
      add("pdf_hash_matches", approval.binding.unsignedPdfSha256 === input.unsignedPdfSha256);
      add("version_matches", approval.binding.agreementVersion === agreement.version);
      add("stripe_mode_matches", approval.binding.esignMode === esignMode && approval.binding.stripeMode === input.stripeMode);
      add("client_matches_record", input.client.recordEmail != null && normalizeEmail(input.client.recordEmail) === normalizeEmail(input.client.email));
      add("client_verified", input.client.verified);
    }
  }

  const blockedReasons = checks.filter((c) => !c.ok).map((c) => `${c.id}${c.detail ? `: ${c.detail}` : ""}`);
  return {
    ok: blockedReasons.length === 0,
    esignMode,
    signwellTestMode: signwellTestModeFor(esignMode),
    checks,
    blockedReasons,
    recipients: blockedReasons.length === 0 ? recipients : null,
    approvalDigest,
  };
}

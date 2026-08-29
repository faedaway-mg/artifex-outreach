// ─────────────────────────────────────────────────────────────────────────────
// Client-closing workflow server actions (Gates 3/4/5 wiring). These are the
// server-authoritative operations the operator UI calls. Approval NEVER sends; send
// requires a separate one-time authorization; the send action goes through the
// authoritative preflight + shared two-signer builder — it never reconstructs request
// fields. Browser input is not authoritative: identity/mode come from persisted state +
// server config. Everything stays dormant behind the production flags.
// ─────────────────────────────────────────────────────────────────────────────
import {
  getAgreement, getAgreementApproval, insertAgreementApproval, updateAgreement,
} from "../repo";
import { nowIso } from "../store";
import { buildApprovalBinding, approvalDigest, bindingDriftReasons, type StripeMode, type AgreementApproval } from "./approval";
import { canSetEsignMode, signwellTestModeFor, type EsignMode } from "../esign/mode";
import { resolveProviderSignerConfig } from "../esign/provider-config";
import { validateProductionRecipients, validateTestRecipients } from "../billing/recipient-policy";
import { closingCan } from "../billing/authz";
import type { Role } from "../operators/roles";
import { sendPreflight, type PreflightReceipt } from "./send-preflight";
import type { CreateSignatureRequestInput, CreateSignatureRequestResult } from "../esign/provider";

export interface ApproveResult {
  ok: boolean;
  approvalId?: string;
  digest?: string;
  blocked?: boolean;
  reason?: string;
  /** True when an identical approval already existed (idempotent). */
  idempotent?: boolean;
}

export interface ApproveInput {
  agreementId: string;
  actor: string;
  actorRole: Role;
  esignMode: EsignMode; // derived SERVER-SIDE by the caller
  stripeMode: StripeMode;
  client: { name: string; email: string; verified: boolean; recordEmail: string | null };
  unsignedPdfSha256: string;
  /** The operator's explicit "I approve this exact agreement…" confirmation. */
  confirmed: boolean;
  operatorEmails?: string[];
  knownTestRecipients?: string[];
  env?: NodeJS.ProcessEnv;
  expiresAt?: string | null;
}

/**
 * Persist an immutable owner approval bound to the exact terms + recipients + PDF. Never
 * sends. Idempotent for an identical approval; rejects a conflicting one (a material change
 * requires a new agreement version + fresh approval). Browser fields are not trusted —
 * provider identity comes from server config; the binding is recomputed server-side.
 */
export async function approveAgreementForSigning(input: ApproveInput): Promise<ApproveResult> {
  if (!closingCan(input.actorRole, "approveAgreement")) return { ok: false, blocked: true, reason: `Role '${input.actorRole}' cannot approve agreements.` };
  if (!input.confirmed) return { ok: false, blocked: true, reason: "Explicit approval confirmation is required." };

  const agreement = await getAgreement(input.agreementId);
  if (!agreement) return { ok: false, blocked: true, reason: "Agreement not found." };
  if (agreement.supersededById) return { ok: false, blocked: true, reason: "This agreement version has been superseded." };
  if (!canSetEsignMode(agreement.status)) return { ok: false, blocked: true, reason: `Cannot approve once the agreement is '${agreement.status}' (past pre-send).` };

  const production = input.esignMode === "production";
  const providerCfg = resolveProviderSignerConfig(input.env ?? process.env, production);
  if (production && !providerCfg.ok) return { ok: false, blocked: true, reason: `Provider config invalid: ${providerCfg.issues.join("; ")}` };
  const providerEmail = providerCfg.config?.signerEmail ?? "";

  // Recipient policy (production is strict; test allows owner aliases).
  const policy = production
    ? validateProductionRecipients({ providerEmail, providerFromServerConfig: true, clientEmail: input.client.email, clientEmailVerified: input.client.verified, clientRecordEmail: input.client.recordEmail, operatorEmails: input.operatorEmails, knownTestRecipients: input.knownTestRecipients })
    : validateTestRecipients({ providerEmail: providerEmail || "provider@test.local", clientEmail: input.client.email });
  if (!policy.ok) return { ok: false, blocked: true, reason: `Recipient policy failed: ${policy.issues.join("; ")}` };

  const binding = buildApprovalBinding(agreement, {
    providerSignerEmail: providerEmail || "provider@test.local", clientEmail: input.client.email,
    esignMode: input.esignMode, stripeMode: input.stripeMode, unsignedPdfSha256: input.unsignedPdfSha256, expiresAt: input.expiresAt ?? null,
  });
  const digest = approvalDigest(binding);

  // Idempotency + conflict: an existing approval for this version must match exactly.
  const existing = await getAgreementApproval(agreement.id, agreement.version);
  if (existing) {
    if (existing.digest === digest) return { ok: true, idempotent: true, approvalId: existing.id, digest };
    const drift = bindingDriftReasons(existing.binding, binding);
    return { ok: false, blocked: true, reason: `A different approval already exists for this version (${drift.join(", ") || "digest differs"}). Revoke it or create a new version.` };
  }

  const rec = await insertAgreementApproval({
    agreementId: agreement.id, agreementVersion: agreement.version, binding, digest,
    approvedBy: input.actor, approvedAt: nowIso(), revokedAt: null,
  } as Omit<AgreementApproval, "id">);
  return { ok: true, approvalId: rec.id, digest };
}

// ── Gate 5: real send action wiring ──────────────────────────────────────────
export interface SendResult {
  ok: boolean;
  requestId?: string | null;
  preflight?: PreflightReceipt;
  blocked?: boolean;
  reason?: string;
  idempotent?: boolean;
}

export interface SendInput {
  agreementId: string;
  actor: string;
  actorRole: Role;
  esignMode: EsignMode; // derived SERVER-SIDE by the caller
  stripeMode: StripeMode;
  client: { name: string; email: string; verified: boolean; recordEmail: string | null };
  /** The exact frozen PDF to upload + its SHA-256 (bound into the approval). */
  pdfBase64: string;
  unsignedPdfSha256: string;
  subject: string;
  message: string;
  productionGateOn: boolean; // PRODUCTION_SIGNING_ENABLED
  sendingGateOn: boolean; // AGREEMENT_SENDING_ENABLED
  env?: NodeJS.ProcessEnv;
  operatorEmails?: string[];
  knownTestRecipients?: string[];
  /** INJECTED provider send. Production passes getEsignProvider().createSignatureRequest;
   *  tests/simulation pass an intercepted mock. No provider is called unless preflight passes. */
  sender: (input: CreateSignatureRequestInput) => Promise<CreateSignatureRequestResult>;
}

/**
 * Send an approved agreement for signature THROUGH the authoritative preflight + shared
 * two-signer builder. Never reconstructs request fields; never calls the provider unless
 * preflight fully passes; idempotent — an agreement that already has an esignRequestId is
 * not re-sent (no duplicate SignWell document).
 */
export async function sendApprovedAgreementForSignature(input: SendInput): Promise<SendResult> {
  if (!closingCan(input.actorRole, "sendSignature")) return { ok: false, blocked: true, reason: `Role '${input.actorRole}' cannot send for signature.` };

  const agreement = await getAgreement(input.agreementId);
  if (!agreement) return { ok: false, blocked: true, reason: "Agreement not found." };

  // Idempotency: never create a second SignWell document.
  if (agreement.esignRequestId) return { ok: true, idempotent: true, requestId: agreement.esignRequestId };

  const approval = await getAgreementApproval(agreement.id, agreement.version);
  const providerConfig = resolveProviderSignerConfig(input.env ?? process.env, input.esignMode === "production");

  const preflight = sendPreflight({
    agreement, esignMode: input.esignMode, approval, unsignedPdfSha256: input.unsignedPdfSha256,
    providerConfig, client: input.client, operatorEmails: input.operatorEmails, knownTestRecipients: input.knownTestRecipients,
    productionGateOn: input.productionGateOn, sendingGateOn: input.sendingGateOn, stripeMode: input.stripeMode,
    alreadySent: false, nowIso: nowIso(),
  });
  if (!preflight.ok || !preflight.recipients) {
    return { ok: false, blocked: true, preflight, reason: `Preflight blocked: ${preflight.blockedReasons.join("; ")}` };
  }

  // Build + send via the INJECTED provider (intercepted in tests). test_mode from mode.
  const result = await input.sender({
    agreementId: agreement.id,
    agreementNumber: agreement.agreementNumber,
    pdfBase64: input.pdfBase64,
    subject: input.subject,
    message: input.message,
    signer: { name: input.client.name, email: input.client.email }, // legacy field; recipients takes precedence
    recipients: preflight.recipients,
    remindersDisabled: true,
    testMode: signwellTestModeFor(input.esignMode),
    metadata: { approvalDigest: preflight.approvalDigest ?? "", pdf_sha256: input.unsignedPdfSha256, esignMode: input.esignMode },
  });
  if (!result.ok || !result.requestId) {
    // No sent state on failure — the operator may retry after fixing the cause.
    return { ok: false, blocked: true, preflight, reason: result.error ?? "provider send failed" };
  }

  await updateAgreement(agreement.id, { status: "sent", sentAt: nowIso(), esignProvider: "signwell", esignRequestId: result.requestId, esignMode: input.esignMode });
  return { ok: true, requestId: result.requestId, preflight };
}

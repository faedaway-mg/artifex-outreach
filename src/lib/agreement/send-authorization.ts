// ─────────────────────────────────────────────────────────────────────────────
// Persisted send authorization (Gate 3). SEPARATE from approval: a one-time,
// version-bound, exact-approval/recipient/PDF/mode-bound authorization that must exist
// (active, unconsumed, unrevoked, unexpired) before a SignWell document is created, and
// is CONSUMED exactly once. Drift invalidates it. Idempotent for an identical
// authorization; a conflicting one is rejected.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { getAgreement, getAgreementApproval, getActiveSendAuthorization, insertSendAuthorization } from "../repo";
import { nowIso } from "../store";
import { canSetEsignMode, type EsignMode } from "../esign/mode";
import type { StripeMode } from "./approval";
import { resolveProviderSignerConfig } from "../esign/provider-config";
import { sendPreflight } from "./send-preflight";
import { closingCan } from "../billing/authz";
import type { Role } from "../operators/roles";

export interface SendAuthorization {
  id: string;
  agreementId: string;
  agreementVersion: number;
  approvalId: string;
  approvalDigest: string;
  unsignedPdfSha256: string;
  esignMode: string;
  providerEmail: string;
  clientEmail: string;
  recipientDigest: string;
  operatorId: string;
  authorizedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  consumedAt: string | null;
  esignRequestId: string | null;
  authorizationVersion: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

const norm = (s: string) => (s ?? "").trim().toLowerCase();

/** Stable digest of the ordered recipients (provider then client). */
export function recipientDigest(providerEmail: string, clientEmail: string): string {
  return createHash("sha256").update(JSON.stringify([{ role: "provider", order: 1, email: norm(providerEmail) }, { role: "client", order: 2, email: norm(clientEmail) }])).digest("hex");
}

/** Deterministic idempotency key binding the exact authorization. */
export function sendAuthorizationIdempotencyKey(parts: { agreementId: string; agreementVersion: number; approvalDigest: string; recipientDigest: string; unsignedPdfSha256: string; esignMode: EsignMode }): string {
  return createHash("sha256").update([parts.agreementId, parts.agreementVersion, parts.approvalDigest, parts.recipientDigest, parts.unsignedPdfSha256, parts.esignMode].join("|")).digest("hex");
}

/** True when the authorization can still be used to send. */
export function isSendAuthorizationUsable(auth: SendAuthorization, nowIsoStr: string): boolean {
  if (auth.revokedAt) return false;
  if (auth.consumedAt) return false;
  if (auth.expiresAt && auth.expiresAt <= nowIsoStr) return false;
  return true;
}

export interface AuthorizeSendResult {
  ok: boolean;
  authorizationId?: string;
  idempotencyKey?: string;
  blocked?: boolean;
  reason?: string;
  idempotent?: boolean;
}

export interface AuthorizeSendInput {
  agreementId: string;
  actor: string;
  actorRole: Role;
  esignMode: EsignMode;
  stripeMode: StripeMode;
  client: { name: string; email: string; verified: boolean; recordEmail: string | null };
  unsignedPdfSha256: string;
  productionGateOn: boolean;
  sendingGateOn: boolean;
  operatorEmails?: string[];
  knownTestRecipients?: string[];
  env?: NodeJS.ProcessEnv;
  expiresAt?: string | null;
}

/**
 * Create a persisted send authorization. Requires a matching valid approval and a passing
 * preflight; NEVER sends. Idempotent for an identical authorization (same idempotency key);
 * a different active authorization for the same version is rejected (revoke/new-version).
 */
export async function authorizeAgreementSend(input: AuthorizeSendInput): Promise<AuthorizeSendResult> {
  if (!closingCan(input.actorRole, "sendSignature")) return { ok: false, blocked: true, reason: `Role '${input.actorRole}' cannot authorize sending.` };
  const agreement = await getAgreement(input.agreementId);
  if (!agreement) return { ok: false, blocked: true, reason: "Agreement not found." };
  if (!canSetEsignMode(agreement.status) && !agreement.esignRequestId) {
    // ok to authorize while approved/pre-send; block once sent.
  }
  if (agreement.esignRequestId) return { ok: false, blocked: true, reason: "Agreement already sent." };

  const approval = await getAgreementApproval(agreement.id, agreement.version);
  if (input.esignMode === "production" && !approval) return { ok: false, blocked: true, reason: "No owner approval to authorize sending against." };

  const providerConfig = resolveProviderSignerConfig(input.env ?? process.env, input.esignMode === "production");
  const providerEmail = providerConfig.config?.signerEmail ?? "";

  // Run the authoritative preflight — authorization is only valid if the send would pass.
  const pf = sendPreflight({
    agreement, esignMode: input.esignMode, approval, unsignedPdfSha256: input.unsignedPdfSha256, providerConfig,
    client: input.client, operatorEmails: input.operatorEmails, knownTestRecipients: input.knownTestRecipients,
    productionGateOn: input.productionGateOn, sendingGateOn: input.sendingGateOn, stripeMode: input.stripeMode, alreadySent: false, nowIso: nowIso(),
  });
  if (!pf.ok) return { ok: false, blocked: true, reason: `Preflight blocked: ${pf.blockedReasons.join("; ")}` };

  const rd = recipientDigest(providerEmail, input.client.email);
  const key = sendAuthorizationIdempotencyKey({ agreementId: agreement.id, agreementVersion: agreement.version, approvalDigest: pf.approvalDigest ?? "", recipientDigest: rd, unsignedPdfSha256: input.unsignedPdfSha256, esignMode: input.esignMode });

  // Idempotency / conflict against any existing ACTIVE authorization for this version.
  const active = await getActiveSendAuthorization(agreement.id, agreement.version);
  if (active) {
    if (active.idempotencyKey === key) return { ok: true, idempotent: true, authorizationId: active.id, idempotencyKey: key };
    return { ok: false, blocked: true, reason: "A different active send authorization exists (revoke it or create a new version)." };
  }

  const rec = await insertSendAuthorization({
    agreementId: agreement.id, agreementVersion: agreement.version, approvalId: approval?.id ?? "test", approvalDigest: pf.approvalDigest ?? "",
    unsignedPdfSha256: input.unsignedPdfSha256, esignMode: input.esignMode, providerEmail, clientEmail: input.client.email, recipientDigest: rd,
    operatorId: input.actor, authorizedAt: nowIso(), expiresAt: input.expiresAt ?? null, revokedAt: null, consumedAt: null, esignRequestId: null,
    authorizationVersion: 1, idempotencyKey: key,
  });
  return { ok: true, authorizationId: rec.id, idempotencyKey: key };
}

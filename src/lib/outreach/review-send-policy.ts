// ─────────────────────────────────────────────────────────────────────────────
// Automated send-authorization policy (Gate 4). A DISTINCT authorization — never a simulated
// operator click — that lets a QUALIFYING generated review be sent without manual approval.
//
// Authorization binds to the exact content revision + evidence + PDF bytes + recipient, and is
// only granted when EVERY applicable gate passes: content-eligibility, editorial (non-redundancy),
// evidence support, render/artifact, recipient eligibility, suppression, and not-held. It is
// re-checked immediately before dispatch. Disabled by default (QR_AUTOSEND_ENABLED != "1").
//
// SENDABLE (content) ≠ AUTHORIZED (delivery). This module is the only thing that turns a qualifying
// review into an authorized one under the policy, and it records why.
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, appendAudit, isSuppressed } from "../repo";
import { validEmail } from "../acquisition/compliance";
import { effectiveReviewFor, getEditorialState, deliveryReadiness, renderCurrentArtifact, revisionFingerprint, TEMPLATE_VERSION } from "./review-revisions";

export const AUTO_SEND_POLICY = { id: "qr-autosend", version: "v1" } as const;
export const AUTOSEND_ENV = "QR_AUTOSEND_ENABLED";
export const AUTH_ACTION = "quick-review.send.authorized";

export interface SendAuthorization {
  type: "operator" | "policy";     // operator = version-bound approval; policy = automated qualification
  policyId: string;
  policyVersion: string;
  revisionId: string;              // exact content revision authorized
  evidenceDigest: string;
  pdfSha256: string;               // exact bytes authorized
  templateVersion: string;
  recipient: string;
  campaignId: string;
  authorizedBy: string;            // operator id, or the policy id for automated auth
  at: string;
}

export interface AuthResult { authorized: boolean; reason?: string; auth?: SendAuthorization }

function autosendEnabled(): boolean {
  return process.env[AUTOSEND_ENV] === "1";
}

/**
 * Attempt to AUTONOMOUSLY authorize a qualifying review for sending under the policy. Returns the
 * recorded authorization, or a hold reason. Never sends; never fabricates operator approval. Off by
 * default — with the policy disabled, only reviews already carrying an operator (version-bound)
 * approval can authorize; automated qualification requires QR_AUTOSEND_ENABLED=1.
 */
export async function authorizeForSend(leadId: string, opts: { campaignId: string; now?: string }): Promise<AuthResult> {
  const lead = await getLead(leadId);
  if (!lead) return { authorized: false, reason: "lead not found" };
  const recipient = lead.publicEmail ?? "";
  if (!validEmail(recipient)) return { authorized: false, reason: "no valid recipient email" };
  if (await isSuppressed({ email: recipient, domain: lead.websiteDomain, phone: lead.phone })) return { authorized: false, reason: "recipient suppressed" };

  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { authorized: false, reason: "no review" };
  const state = await getEditorialState(leadId);
  if (state.held) return { authorized: false, reason: `held: ${state.held.reason}` };

  const edited = Object.keys(state.draft ?? {}).length > 0 || state.approval != null || (state.history?.length ?? 0) > 0;

  // Determine the authorization TYPE and that content is genuinely qualified.
  let type: SendAuthorization["type"];
  if (edited) {
    // An edited review must carry a version-bound OPERATOR approval matching the current content.
    const readiness = await deliveryReadiness(leadId);
    if (!readiness?.ready) return { authorized: false, reason: readiness?.reasons[0] ?? "edited review not delivery-ready" };
    type = "operator";
  } else {
    // An unedited review qualifies under the automated POLICY only when it is content-SENDABLE
    // (≥2 findings, or one substantial Observed finding). NEEDS_REVIEW/INSUFFICIENT need an operator.
    if (!autosendEnabled()) return { authorized: false, reason: "auto-send policy disabled" };
    if (eff.review.status !== "SENDABLE") return { authorized: false, reason: `not policy-eligible (status ${eff.review.status})` };
    type = "policy";
  }

  // Render the exact artifact and bind the authorization to its bytes + revision + evidence.
  const art = await renderCurrentArtifact(leadId);
  if (!art) return { authorized: false, reason: "could not render artifact" };
  const auth: SendAuthorization = {
    type, policyId: AUTO_SEND_POLICY.id, policyVersion: AUTO_SEND_POLICY.version,
    revisionId: art.revisionId, evidenceDigest: art.manifest.evidenceDigest, pdfSha256: art.manifest.pdfSha256,
    templateVersion: TEMPLATE_VERSION, recipient, campaignId: opts.campaignId,
    authorizedBy: type === "operator" ? (state.approval?.approvedBy ?? "operator") : AUTO_SEND_POLICY.id,
    at: opts.now ?? new Date().toISOString(),
  };
  await appendAudit({ action: AUTH_ACTION, actor: auth.authorizedBy, targetType: "lead", targetId: leadId, meta: { ...auth }, ip: null });
  return { authorized: true, auth };
}

/**
 * Re-verify an authorization at the FINAL dispatch boundary: the content revision, evidence, template,
 * and PDF bytes must still match what was authorized, the recipient must still be valid + not
 * suppressed, and the review must not be held. Any drift → NOT authorized (fail closed, never bare).
 */
export async function authorizationValidForDispatch(leadId: string, auth: SendAuthorization): Promise<{ ok: boolean; reason?: string }> {
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, reason: "lead not found" };
  if (lead.publicEmail !== auth.recipient || !validEmail(auth.recipient)) return { ok: false, reason: "recipient changed" };
  if (await isSuppressed({ email: auth.recipient, domain: lead.websiteDomain, phone: lead.phone })) return { ok: false, reason: "recipient suppressed since authorization" };
  const state = await getEditorialState(leadId);
  if (state.held) return { ok: false, reason: "held since authorization" };
  if (auth.templateVersion !== TEMPLATE_VERSION) return { ok: false, reason: "template changed since authorization" };
  // Drift is detected via the DETERMINISTIC content fingerprint (a re-render would differ only in the
  // PDF's embedded creation timestamp, not its content). The exact authorized bytes are carried
  // separately by the caller and re-checked against auth.pdfSha256 at attach time (verifyArtifact).
  const eff = await effectiveReviewFor(leadId);
  if (!eff) return { ok: false, reason: "review no longer available" };
  if (revisionFingerprint(eff.review) !== auth.revisionId) return { ok: false, reason: "review changed since authorization" };
  return { ok: true };
}

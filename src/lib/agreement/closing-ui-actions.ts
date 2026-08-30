"use server";
// ─────────────────────────────────────────────────────────────────────────────
// Thin server-action adapters for the Client-Closing workspace UI. Each wraps an
// existing server-authoritative closing action. Nothing here is a security boundary:
// the actor is resolved from the authenticated session (currentActor), the role from
// the persisted operator, the esign mode is derived SERVER-SIDE, and the exact PDF +
// SHA are re-rendered here (never trusted from the browser). Every action returns a
// structured, safe result — never a raw error — and revalidates the closing page.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { currentActor } from "../auth";
import { getAgreement } from "../repo";
import { resolveActorRole } from "../billing/authz";
import { deriveEsignModeFromEnv } from "../esign/mode";
import { agreementSendingEnabled } from "../esign/gate";
import { PRODUCTION_SIGNING_GATE_ENV } from "../esign/mode";
import { renderAgreementPdf } from "../pdf/render-agreement";
import { getEsignProvider } from "../esign/provider";
import { SignwellCompletionFetcher } from "../esign/completion-retrieval";
import { PostgresBlobStorage } from "../billing/postgres-storage";
import { approveAgreementForSigning, sendApprovedAgreementForSignature } from "./closing-workflow";
import { authorizeAgreementSend } from "./send-authorization";
import { loadFrozenUnsignedPdf } from "./frozen-pdf";
import { authorizeLivePayment } from "../billing/live-payment-auth";
import { processCompletionRetention } from "../billing/completion-retention";
import type { StripeMode } from "./approval";
import type { Agreement } from "../types";

export interface ActionResult {
  ok: boolean;
  code?: string;
  message: string;
  retryable?: boolean;
}

const CLOSING_PATH = (id: string) => `/closing/${id}`;

function productionSigningEnabled(): boolean {
  const v = (process.env[PRODUCTION_SIGNING_GATE_ENV] ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** stripeMode follows esignMode: production→live, test→test. */
function stripeModeFor(mode: "test" | "production"): StripeMode {
  return mode === "production" ? "live" : "test";
}

/** Render the exact frozen PDF and its SHA-256 server-side (never from the browser). */
async function renderPdfAndSha(agreement: Agreement): Promise<{ pdfBase64: string; sha256: string }> {
  // The unsigned PDF that is approved/sent shows the legal-review banner iff sending is off.
  const buffer = await renderAgreementPdf(agreement, !agreementSendingEnabled());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return { pdfBase64: Buffer.from(buffer).toString("base64"), sha256 };
}

/**
 * The exact unsigned PDF to authorize/send: the FROZEN artifact captured at approval,
 * reused byte-for-byte (the renderer is not deterministic). Falls back to a fresh render
 * only for a legacy agreement approved before freezing existed.
 */
async function frozenOrRenderedPdf(agreement: Agreement): Promise<{ pdfBase64: string; sha256: string }> {
  const frozen = await loadFrozenUnsignedPdf(agreement.id, agreement.version);
  return frozen ?? renderPdfAndSha(agreement);
}

/** Client identity used by the closing actions comes from the persisted snapshot. */
function clientOf(agreement: Agreement): { name: string; email: string; verified: boolean; recordEmail: string | null } {
  const c = agreement.contentSnapshot;
  return { name: c.clientContactName, email: c.clientEmail, verified: false, recordEmail: c.clientEmail ?? null };
}

export async function approveAction(agreementId: string, opts: { confirmed: boolean }): Promise<ActionResult> {
  try {
    const actor = currentActor();
    const role = await resolveActorRole(actor);
    const agreement = await getAgreement(agreementId);
    if (!agreement) return { ok: false, code: "not_found", message: "Agreement not found." };
    const esignMode = deriveEsignModeFromEnv(productionSigningEnabled());
    const { pdfBase64, sha256 } = await renderPdfAndSha(agreement);
    const res = await approveAgreementForSigning({
      agreementId, actor, actorRole: role, esignMode, stripeMode: stripeModeFor(esignMode),
      client: clientOf(agreement), unsignedPdfSha256: sha256, unsignedPdfBase64: pdfBase64, confirmed: opts.confirmed, env: process.env,
    });
    revalidatePath(CLOSING_PATH(agreementId));
    if (!res.ok) return { ok: false, code: "blocked", message: res.reason ?? "Approval was blocked." };
    return { ok: true, message: res.idempotent ? "Already approved (no change)." : "Agreement approved for signing." };
  } catch {
    return { ok: false, code: "error", message: "Approval failed unexpectedly.", retryable: true };
  }
}

export async function authorizeSendAction(agreementId: string): Promise<ActionResult> {
  try {
    const actor = currentActor();
    const role = await resolveActorRole(actor);
    const agreement = await getAgreement(agreementId);
    if (!agreement) return { ok: false, code: "not_found", message: "Agreement not found." };
    const esignMode = deriveEsignModeFromEnv(productionSigningEnabled());
    const { sha256 } = await frozenOrRenderedPdf(agreement);
    const res = await authorizeAgreementSend({
      agreementId, actor, actorRole: role, esignMode, stripeMode: stripeModeFor(esignMode),
      client: clientOf(agreement), unsignedPdfSha256: sha256,
      productionGateOn: productionSigningEnabled(), sendingGateOn: agreementSendingEnabled(), env: process.env,
    });
    revalidatePath(CLOSING_PATH(agreementId));
    if (!res.ok) return { ok: false, code: "blocked", message: res.reason ?? "Send authorization was blocked." };
    return { ok: true, message: res.idempotent ? "Send already authorized." : "Sending authorized." };
  } catch {
    return { ok: false, code: "error", message: "Send authorization failed unexpectedly.", retryable: true };
  }
}

export async function sendAction(agreementId: string): Promise<ActionResult> {
  try {
    const actor = currentActor();
    const role = await resolveActorRole(actor);
    const agreement = await getAgreement(agreementId);
    if (!agreement) return { ok: false, code: "not_found", message: "Agreement not found." };
    const esignMode = deriveEsignModeFromEnv(productionSigningEnabled());
    const { pdfBase64, sha256 } = await frozenOrRenderedPdf(agreement);
    const c = agreement.contentSnapshot;
    const res = await sendApprovedAgreementForSignature({
      agreementId, actor, actorRole: role, esignMode, stripeMode: stripeModeFor(esignMode),
      client: clientOf(agreement), pdfBase64, unsignedPdfSha256: sha256,
      subject: `Agreement ${c.agreementNumber} for signature`,
      message: "Please review and sign the attached agreement.",
      productionGateOn: productionSigningEnabled(), sendingGateOn: agreementSendingEnabled(), env: process.env,
      sender: (i) => getEsignProvider().createSignatureRequest(i),
    });
    revalidatePath(CLOSING_PATH(agreementId));
    if (!res.ok) return { ok: false, code: "blocked", message: res.reason ?? "Sending was blocked." };
    return { ok: true, message: res.idempotent ? "Already sent (no duplicate)." : "Agreement sent for signature." };
  } catch {
    return { ok: false, code: "error", message: "Sending failed unexpectedly.", retryable: true };
  }
}

export async function authorizePaymentAction(agreementId: string): Promise<ActionResult> {
  try {
    const actor = currentActor();
    const role = await resolveActorRole(actor);
    const agreement = await getAgreement(agreementId);
    if (!agreement) return { ok: false, code: "not_found", message: "Agreement not found." };
    const c = agreement.contentSnapshot;
    const res = await authorizeLivePayment({
      agreementId, actor, actorRole: role, amountCents: c.depositAmountCents, currency: c.currency,
    });
    revalidatePath(CLOSING_PATH(agreementId));
    if (!res.ok) return { ok: false, code: "blocked", message: res.reason ?? "Live-payment authorization was blocked." };
    return { ok: true, message: "Live payment authorized." };
  } catch {
    return { ok: false, code: "error", message: "Live-payment authorization failed unexpectedly.", retryable: true };
  }
}

export async function retryRetentionAction(agreementId: string): Promise<ActionResult> {
  try {
    const res = await processCompletionRetention(agreementId, {
      fetcher: new SignwellCompletionFetcher(),
      storage: new PostgresBlobStorage(),
    });
    revalidatePath(CLOSING_PATH(agreementId));
    if (res.status === "retained") return { ok: true, message: "Signed artifacts retained." };
    if (res.status === "failed") return { ok: false, code: "retention_failed", message: res.reason ?? "Retention failed — retry available.", retryable: true };
    return { ok: false, code: res.status, message: res.reason ?? `Retention is '${res.status}'.`, retryable: true };
  } catch {
    return { ok: false, code: "error", message: "Retention retry failed unexpectedly.", retryable: true };
  }
}

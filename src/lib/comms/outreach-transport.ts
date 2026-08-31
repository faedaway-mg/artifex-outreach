// ─────────────────────────────────────────────────────────────────────────────
// Canonical compliant cold-outreach transport. This is the ONE place a cold-outreach message is turned
// into a delivery, for BOTH layers:
//   • Layer B (scheduled Quick-Review runner) → sendCompliantOutreach()  [persisted SendAuthorization]
//   • Layer A (AcquisitionPlan/Step dispatcher) → buildColdDispatchFromEmail() → submitCompliantDispatch()
// Both build the SAME canonical OutreachDispatchRequest and submit it through the SAME core
// (submitCompliantDispatch). The transport is RESEND (the configured provider); cold outreach has no
// provider SELECTION — it cannot pick an arbitrary sender and cannot bypass compliance. Compliant by
// construction: recipient/PDF-drift guards, fail-closed CAN-SPAM footer (exact postal + signed
// recipient-bound one-click unsubscribe), List-Unsubscribe + One-Click headers, the authorized PDF,
// permanent-suppression rechecks (including one IMMEDIATELY before submission), a provider-neutral
// recipient gate (test address until the owner enables prospect delivery), and ambiguous-send
// protection (a post-submit network/timeout fault is NEVER blindly resent; Resend's Idempotency-Key is
// a second guard). A provider message id is persisted as truthful state.
// (Microsoft Graph was evaluated and abandoned — it is not an operational dependency of this module.)
// ─────────────────────────────────────────────────────────────────────────────
import { getLead } from "../repo";
import { effectiveReviewFor } from "../outreach/review-revisions";
import { escapeHtml } from "../outreach/email-render";
import { resolveApprovedArtifactForSend } from "../outreach/resolve-approved-artifact";
import type { FreezeDeps, ResolvedFrozenReview } from "../outreach/quick-review-freeze";
import { assembleCommercialMessage } from "./commercial-message";
import { getEmailProvider } from "./provider";
import type { EmailMessage, EmailProvider } from "./provider";
import { isEmailSuppressed } from "./suppression";
import { sha256 } from "./receipt";
import { validEmail } from "../acquisition/compliance";
import { type MessageClass, classifyLeadSource, isColdOutreach } from "./transport-policy";
import type { SendAuthorization } from "../outreach/review-send-policy";
import type { Lead } from "../types";
import type { QuickReview } from "../outreach/quick-review";

/** The result shape the scheduled runner (runScheduledOutreach) consumes. */
export interface OutreachSendResult { ok: boolean; providerId?: string | null; ambiguous?: boolean; reason?: string }

/** The full transport result (so callers can classify sent / retry / fail / ambiguous). */
export interface ColdSubmitResult { sent: boolean; providerMessageId: string | null; errorCode?: string; reason?: string; retryable?: boolean; ambiguous?: boolean; statusCode?: number }

export interface TransportDeps {
  isSuppressed?: (email: string) => Promise<boolean>;       // final-boundary suppression check
  loadLead?: (leadId: string) => Promise<Lead | null>;      // default: repo.getLead
  loadReview?: (leadId: string) => Promise<{ lead: Lead; review: QuickReview } | null>; // default: effectiveReviewFor
  provider?: EmailProvider;                                 // intercepted transport (rehearsal only)
  freeze?: FreezeDeps;                                      // injected freeze/resolve seams (tests)
  /** The canonical frozen-artifact resolver. Defaults to resolveApprovedArtifactForSend; a test may
   *  inject a fixed frozen artifact. Bytes still pass the toFrozenAttachment integrity check + the
   *  auth.pdfSha256 binding, so this seam cannot smuggle un-frozen bytes onto the wire. */
  resolveArtifact?: (leadId: string) => Promise<ResolvedFrozenReview>;
}

const bareAddress = (from: string): string => { const m = from.match(/<([^>]+)>/); return (m ? m[1] : from).trim(); };

/** Provider-NEUTRAL cold-recipient gate (not provider-specific). Until COMMS_PROSPECT_DELIVERY_ENABLED=1,
 *  a cold message may go ONLY to the Artifex-controlled COMMS_TEST_RECIPIENT — this is what makes the
 *  controlled single test possible and blocks prospect delivery until the owner authorizes it. */
export function allowedColdRecipient(to: string): { ok: boolean; reason?: string } {
  if (process.env.COMMS_PROSPECT_DELIVERY_ENABLED === "1") return { ok: true };
  const allow = (process.env.COMMS_TEST_RECIPIENT ?? "").toLowerCase().trim();
  if (allow && to.toLowerCase().trim() === allow) return { ok: true };
  return { ok: false, reason: "prospect delivery disabled — recipient is not the configured test address" };
}

/** A canonical, fully-typed cold-outreach dispatch request. `bodyText`/`bodyHtml` already include the
 *  compliant footer (built by an adapter). Submission is transport-agnostic of how it was assembled. */
export interface OutreachDispatchRequest {
  leadId: string;
  recipient: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  pdfBase64?: string;
  pdfFilename?: string;
  idempotencyKey: string;
  classification: MessageClass;
  /** MIME Message-ID (threading anchor). Defaults to idempotencyKey when absent. */
  messageId?: string;
  inReplyTo?: string;
  references?: string;
}

/**
 * The shared submit core. Takes a canonical, footer-assembled request + its unsubscribe URL and
 * submits it via the RESEND transport. Enforces (in order): route guard → transport configured →
 * provider-neutral recipient gate → FINAL suppression recheck immediately before submission → submit
 * once with the compliant HTML + plain-text body, List-Unsubscribe + One-Click headers, and the
 * authorized PDF. Returns the full result so callers can classify sent / retry / fail / ambiguous. A
 * post-submit network/timeout fault becomes AMBIGUOUS (never blindly resent).
 */
export async function submitCompliantDispatch(
  req: OutreachDispatchRequest,
  unsubscribeUrl: string,
  deps: { isSuppressed?: (email: string) => Promise<boolean>; provider?: EmailProvider } = {},
): Promise<ColdSubmitResult> {
  if (!isColdOutreach(req.classification)) {
    return { sent: false, providerMessageId: null, retryable: false, errorCode: "route-refused", reason: `classification ${req.classification} is not a compliant cold route` };
  }
  // The transport is the configured provider (Resend) via getEmailProvider(); a guarded intercepted
  // double may stand in for the no-send rehearsal (never in production). Fail closed when it cannot send.
  const provider = deps.provider ?? getEmailProvider();
  if (!provider.canSend) {
    return { sent: false, providerMessageId: null, retryable: false, errorCode: "unconfigured", reason: "cold-outreach transport is not configured (no sending provider)." };
  }
  const gate = allowedColdRecipient(req.recipient);
  if (!gate.ok) return { sent: false, providerMessageId: null, retryable: false, errorCode: "recipient-gate", reason: gate.reason };
  // FINAL suppression recheck — independently, immediately before submission. A stale "eligible"
  // upstream never overrides current suppression.
  const isSuppressed = deps.isSuppressed ?? isEmailSuppressed;
  if (await isSuppressed(req.recipient)) {
    return { sent: false, providerMessageId: null, retryable: false, errorCode: "suppressed", reason: "recipient suppressed (final boundary)" };
  }

  const from = process.env.RESEND_FROM || "Artifex Labs <hello@artifexlabs.tech>";
  const headers: Record<string, string> = {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    ...(req.messageId ? { "Message-ID": req.messageId } : {}),
    ...(req.inReplyTo ? { "In-Reply-To": req.inReplyTo } : {}),
    ...(req.references ? { References: req.references } : {}),
  };
  const msg: EmailMessage = {
    to: req.recipient, from, replyTo: bareAddress(from),
    subject: req.subject, text: req.bodyText, html: req.bodyHtml, headers,
    ...(req.pdfBase64 && req.pdfFilename ? { attachments: [{ filename: req.pdfFilename, content: req.pdfBase64, contentType: "application/pdf" }] } : {}),
    idempotencyKey: req.idempotencyKey,
  };
  const res = await provider.send(msg);
  // Ambiguous-send protection: a network/timeout fault happens AFTER the POST is dispatched — Resend
  // may already have accepted the message. Do NOT blindly resend (the ledger + Resend Idempotency-Key
  // are the reconcile guards). A status-bearing 429/5xx means Resend explicitly did NOT accept → safe retry.
  if (!res.sent && (res.errorCode === "network" || res.errorCode === "timeout")) {
    return { sent: false, providerMessageId: null, retryable: false, ambiguous: true, errorCode: "ambiguous_submit", reason: res.reason };
  }
  return { sent: res.sent, providerMessageId: res.providerMessageId, retryable: res.retryable, errorCode: res.errorCode, reason: res.reason, statusCode: res.statusCode };
}

// ── Compile-time bypass guard: the ONLY attachment a cold message can carry is a FrozenAttachment,
// which is nominally branded and can be minted ONLY by toFrozenAttachment() from a resolved frozen
// artifact. A future caller therefore cannot pass arbitrary/rerendered PDF bytes to the assembler —
// the type simply won't accept them.
declare const FROZEN_ATTACHMENT_BRAND: unique symbol;
export interface FrozenAttachment {
  readonly base64: string;
  readonly filename: string;
  readonly sha256: string;
  readonly [FROZEN_ATTACHMENT_BRAND]: true;
}

/** Mint a FrozenAttachment from a resolved frozen artifact. RUNTIME guard: the bytes MUST hash to the
 *  claimed frozen SHA — a re-render or a swap cannot produce a valid one. This is the sole constructor. */
export function toFrozenAttachment(a: { pdfBase64: string; filename: string; sha256: string }): FrozenAttachment {
  if (sha256(Buffer.from(a.pdfBase64, "base64")) !== a.sha256) {
    throw new Error("frozen attachment integrity check failed (bytes do not match the frozen SHA)");
  }
  // The brand is a COMPILE-TIME-only nominal marker (erased at runtime); the assertion is the sole way
  // to obtain the branded type, and this function is its only constructor.
  return { base64: a.pdfBase64, filename: a.filename, sha256: a.sha256 } as FrozenAttachment;
}

/**
 * LAYER A adapter — wrap the compliant CAN-SPAM footer + hardened unsubscribe around an already-built
 * Acquisition OS step email (subject + plaintext + HTML + optional FROZEN Quick Review PDF + threading),
 * and produce the canonical request. FAIL CLOSED: an invalid recipient, or a footer that cannot be
 * assembled (no postal address / no unsubscribe secret), yields no request → nothing can be sent. The
 * attachment can ONLY be a FrozenAttachment (branded) — arbitrary bytes are rejected at compile time.
 */
export function buildColdDispatchFromEmail(input: {
  leadId: string; recipient: string; subject: string; bodyText: string; bodyHtml: string;
  classification: MessageClass; idempotencyKey: string;
  pdf?: FrozenAttachment | null;
  threading?: { messageId?: string; inReplyTo?: string; references?: string };
}): { ok: true; req: OutreachDispatchRequest; unsubscribeUrl: string } | { ok: false; reason: string } {
  if (!validEmail(input.recipient)) return { ok: false, reason: "invalid-recipient" };
  const assembled = assembleCommercialMessage({ leadId: input.leadId, recipient: input.recipient, subject: input.subject, bodyHtml: input.bodyHtml, bodyText: input.bodyText });
  if (!assembled.ok) return { ok: false, reason: `footer:${assembled.reason}` };
  const req: OutreachDispatchRequest = {
    leadId: input.leadId, recipient: input.recipient, subject: input.subject,
    bodyText: assembled.text, bodyHtml: assembled.html,
    pdfBase64: input.pdf?.base64, pdfFilename: input.pdf?.filename,
    idempotencyKey: input.idempotencyKey, classification: input.classification,
    messageId: input.threading?.messageId, inReplyTo: input.threading?.inReplyTo, references: input.threading?.references,
  };
  return { ok: true, req, unsubscribeUrl: assembled.unsubscribeUrl };
}

/** Canonical cover message (subject + plain-text + HTML) for a single Quick Review send. EVERY
 *  single-QR caller (Layer B, send-one-branded, the dry-run preview) composes through THIS function so
 *  they are byte-identical for the same review. The compliant footer is added downstream by the adapter. */
export function composeReviewMessage(review: QuickReview, businessName: string): { subject: string; text: string; html: string } {
  const { text, html } = composeBody(review);
  return { subject: `Quick Review — ${businessName}`, text, html };
}

/** Compose the plain-text + HTML cover body from the EXACT persisted review content (Layer B). */
function composeBody(review: QuickReview): { text: string; html: string } {
  const paras: string[] = [];
  if (review.openingHook) paras.push(review.openingHook);
  if (review.whyItMatters) paras.push(review.whyItMatters);
  paras.push("I put the details in the attached one-page Quick Review.");
  const bookingUrl = review.cta?.bookingUrl ?? null;
  const text = [...paras, ...(bookingUrl ? [`Book a short conversation: ${bookingUrl}`] : [])].join("\n\n");
  const html =
    paras.map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p)}</p>`).join("\n") +
    (bookingUrl ? `\n<p style="margin:0 0 14px;">Book a short conversation: <a href="${escapeHtml(bookingUrl)}">${escapeHtml(bookingUrl.replace(/^https?:\/\//, ""))}</a></p>` : "");
  return { text, html };
}

/**
 * LAYER B — build the canonical typed request from PERSISTED state (SendAuthorization + authorized PDF
 * bytes + persisted review), or refuse (fail-closed). Enforces recipient-drift, PDF-drift, and
 * footer-assembly up front, so a request only exists when the message is fully compliant.
 */
export async function buildOutreachDispatch(
  args: { leadId: string; auth: SendAuthorization },
  deps: TransportDeps = {},
): Promise<{ ok: true; req: OutreachDispatchRequest; unsubscribeUrl: string } | { ok: false; reason: string }> {
  const { leadId, auth } = args;
  const recipient = auth.recipient;
  if (!validEmail(recipient)) return { ok: false, reason: "invalid-recipient" };

  const loadReview = deps.loadReview ?? ((id: string) => effectiveReviewFor(id));
  const loadLead = deps.loadLead ?? ((id: string) => getLead(id));

  const lead = await loadLead(leadId);
  if (!lead) return { ok: false, reason: "lead-not-found" };
  if ((lead.publicEmail ?? "") !== recipient) return { ok: false, reason: "recipient-drift" };

  // The attachment comes ONLY from the canonical resolver (frozen bytes) — the caller cannot inject a
  // PDF. The authorization is bound to those bytes: a SHA mismatch is drift and fails closed.
  const resolve = deps.resolveArtifact ?? ((id: string) => resolveApprovedArtifactForSend(id, deps.freeze));
  const resolved = await resolve(leadId);
  if (!resolved.ok) return { ok: false, reason: `frozen-review:${resolved.reason}` };
  if (resolved.sha256 !== auth.pdfSha256) return { ok: false, reason: "pdf-drift" };

  const eff = await loadReview(leadId);
  if (!eff?.review) return { ok: false, reason: "no-review" };
  const { subject, text: bodyText, html: bodyHtml } = composeReviewMessage(eff.review, lead.businessName);

  return buildColdDispatchFromEmail({
    leadId, recipient, subject, bodyText, bodyHtml,
    classification: classifyLeadSource(lead.source),
    idempotencyKey: `outreach:${leadId}:${auth.revisionId}`,
    pdf: toFrozenAttachment({ pdfBase64: resolved.pdfBase64!, filename: resolved.filename!, sha256: resolved.sha256! }),
  });
}

/**
 * LAYER B production transport (the runScheduledOutreach `deps.send`). Assembles from persisted state
 * and submits via Graph only. Returns the { ok, providerId, ambiguous } shape the runner expects.
 */
export async function sendCompliantOutreach(
  args: { leadId: string; auth: SendAuthorization },
  deps: TransportDeps = {},
): Promise<OutreachSendResult> {
  const recipient = args.auth.recipient;
  const isSuppressed = deps.isSuppressed ?? isEmailSuppressed;
  if (await isSuppressed(recipient)) return { ok: false, reason: "suppressed" };

  const built = await buildOutreachDispatch(args, deps);
  if (!built.ok) return { ok: false, reason: built.reason };

  const res = await submitCompliantDispatch(built.req, built.unsubscribeUrl, { isSuppressed: deps.isSuppressed, provider: deps.provider });
  if (res.sent) return { ok: true, providerId: res.providerMessageId };
  if (res.ambiguous) return { ok: false, ambiguous: true, reason: res.reason };
  return { ok: false, reason: res.errorCode ?? res.reason ?? "refused" };
}

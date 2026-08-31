// ─────────────────────────────────────────────────────────────────────────────
// THE ONE canonical cold-outreach prepare/submit boundary. Every cold-email entry point —
// the Acquisition OS step dispatcher (Layer A), the scheduled Quick-Review runner (Layer B),
// the send-one-branded final-CX check, the controlled-test dry run — assembles and submits a
// prospect message through THIS boundary. There is exactly one place a cold message becomes a
// delivery, and it is compliant-by-construction:
//
//   prepareCanonicalColdOutreach() — PURE-ish (one blob read): loads the FROZEN Quick Review PDF
//     via resolveFrozenReviewForSend (fail-closed on missing approval / drift / tamper — it never
//     renders), then wraps the exact bytes + the CAN-SPAM footer + signed one-click unsubscribe +
//     List-Unsubscribe/One-Click headers around the caller's branded body. Returns the complete
//     prepared identity: recipient, subject, filename, frozen SHA-256, byte length, idempotency key.
//
//   submitCanonicalColdOutreach() — the single submit: final suppression + recipient-lock + provider
//     invocation + ambiguous-send protection (submitCompliantDispatch). No path bypasses it.
//
// prepareCanonicalReviewOutreach() is the single-Quick-Review convenience: it composes the canonical
// cover body from the approved review so send-one-branded and the dry run are byte-identical.
// ─────────────────────────────────────────────────────────────────────────────
import { effectiveReviewFor } from "../outreach/review-revisions";
import { classifyLeadSource, type MessageClass } from "./transport-policy";
import {
  buildColdDispatchFromEmail, submitCompliantDispatch, composeReviewMessage,
  type OutreachDispatchRequest, type ColdSubmitResult,
} from "./outreach-transport";
import { resolveFrozenReviewForSend, type FreezeDeps } from "../outreach/quick-review-freeze";
import type { EmailProvider } from "./provider";

export interface CanonicalPrepareInput {
  leadId: string;
  recipient: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  classification: MessageClass;
  idempotencyKey: string;
  threading?: { messageId?: string; inReplyTo?: string; references?: string };
}

export interface PreparedCanonicalOutreach {
  req: OutreachDispatchRequest;
  unsubscribeUrl: string;
  recipient: string;
  subject: string;
  filename: string;
  pdfSha256: string;
  byteSize: number;
  reviewVersion: number;
  idempotencyKey: string;
}

export type CanonicalPrepareResult =
  | { ok: true; prepared: PreparedCanonicalOutreach }
  | { ok: false; reason: string; blocked: true };

/**
 * Assemble the complete compliant cold-outreach message around the FROZEN Quick Review PDF. Fails
 * closed (no request produced) when: the review is not approved/frozen, the source content has
 * drifted, the frozen bytes are missing or tampered, the recipient is invalid, or the CAN-SPAM footer
 * cannot be built (no postal address / no unsubscribe secret). NEVER renders a PDF.
 */
export async function prepareCanonicalColdOutreach(
  input: CanonicalPrepareInput,
  deps: { freeze?: FreezeDeps } = {},
): Promise<CanonicalPrepareResult> {
  const frozen = await resolveFrozenReviewForSend(input.leadId, deps.freeze);
  if (!frozen.ok) return { ok: false, blocked: true, reason: `frozen-review:${frozen.reason}` };

  const built = buildColdDispatchFromEmail({
    leadId: input.leadId, recipient: input.recipient, subject: input.subject,
    bodyText: input.bodyText, bodyHtml: input.bodyHtml,
    classification: input.classification, idempotencyKey: input.idempotencyKey,
    pdf: { base64: frozen.pdfBase64!, filename: frozen.filename! },
    threading: input.threading,
  });
  if (!built.ok) return { ok: false, blocked: true, reason: `assembly:${built.reason}` };

  return {
    ok: true,
    prepared: {
      req: built.req, unsubscribeUrl: built.unsubscribeUrl,
      recipient: input.recipient, subject: input.subject,
      filename: frozen.filename!, pdfSha256: frozen.sha256!, byteSize: frozen.byteSize!,
      reviewVersion: frozen.version!, idempotencyKey: input.idempotencyKey,
    },
  };
}

/**
 * Single-Quick-Review convenience: compose the canonical cover body from the approved review, then
 * prepare through the canonical boundary. send-one-branded and the dry-run BOTH call this, so their
 * subject / bodies / headers / filename / SHA are identical for the same lead + recipient.
 */
export async function prepareCanonicalReviewOutreach(
  input: { leadId: string; recipient: string; idempotencyKey?: string; threading?: CanonicalPrepareInput["threading"] },
  deps: { freeze?: FreezeDeps; loadReview?: (leadId: string) => Promise<{ lead: { businessName: string; source: string | null }; review: import("../outreach/quick-review").QuickReview } | null> } = {},
): Promise<CanonicalPrepareResult> {
  const loadReview = deps.loadReview ?? ((id: string) => effectiveReviewFor(id));
  const eff = await loadReview(input.leadId);
  if (!eff?.review) return { ok: false, blocked: true, reason: "no-review" };
  const lead = eff.lead;
  const { subject, text, html } = composeReviewMessage(eff.review, lead.businessName);
  return prepareCanonicalColdOutreach({
    leadId: input.leadId, recipient: input.recipient, subject, bodyText: text, bodyHtml: html,
    classification: classifyLeadSource(lead.source),
    idempotencyKey: input.idempotencyKey ?? `canonical-outreach:${input.leadId}`,
    threading: input.threading,
  }, { freeze: deps.freeze });
}

/** The single submit — final suppression + recipient-lock + provider + ambiguous protection. */
export async function submitCanonicalColdOutreach(
  prepared: PreparedCanonicalOutreach,
  deps: { isSuppressed?: (email: string) => Promise<boolean>; provider?: EmailProvider } = {},
): Promise<ColdSubmitResult> {
  return submitCompliantDispatch(prepared.req, prepared.unsubscribeUrl, deps);
}

// ─────────────────────────────────────────────────────────────────────────────
// SignWell webhook ingestion. Same shape as the Resend webhook pipeline:
//   1. verify signature (fail closed in production if a secret is configured),
//   2. dedupe on the provider event id (duplicate deliveries are a no-op),
//   3. parse → map to a monotonic agreement status transition,
//   4. apply the transition + side effects (signed → unlock the deposit).
//
// An agreement is NEVER marked signed from an unverified request. The deposit is
// created (status: pending) ONLY after the signed state is committed — and even
// then it is not SENT; sending is a separate, gated operator action.
//
// SIGNATURE SCHEME (verified vs SignWell docs 2026-08-27, developers.signwell.com/
// reference/event-hash-verification): the signature is `event.hash` INSIDE the JSON
// body (NOT an HTTP header, NOT over the raw body). It is HMAC-SHA256, hex-encoded,
// of the message `${event.type}@${event.time}`, keyed by the WEBHOOK ID (returned by
// Create/List Webhooks). SIGNWELL_WEBHOOK_SECRET holds that webhook id. Because the
// signed message is only type+time, it authenticates the event but does not
// integrity-protect the body — so we treat body data as a pointer.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getAgreementByEsignRequestId,
  updateAgreement,
  updateLead,
  insertAgreementEventIfAbsent,
  paymentsForAgreement,
  insertPayment,
} from "../repo";
import { nowIso } from "../store";
import type { Agreement, AgreementStatus } from "../types";
import { modeMismatchReason, type EsignMode } from "./mode";

/**
 * Verify SignWell's `event.hash` = HMAC-SHA256(key = webhook id, msg = `type@time`),
 * hex, timing-safe. `type`/`time` are the RAW values from the event body.
 */
export function verifySignwellEventHash(webhookId: string, type: string, time: string, hash: string | null): boolean {
  if (!hash || !type || !time) return false;
  const expected = createHmac("sha256", webhookId).update(`${type}@${time}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(hash.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

// `recipient_signed` = ONE signer finished their part; it does NOT mean the document is
// complete. `signed` is our terminal, deposit-unlocking state and must map ONLY from the
// document-level "all required signers completed" event.
export type AgreementEventType = "viewed" | "recipient_signed" | "signed" | "declined" | "voided";

// SignWell fires `document_signed` per SIGNER (verified live: it arrived with
// provider:viewed while only the client had completed). Only `document_completed` means
// EVERY required signer finished. Mapping `document_signed` → signed unlocked the deposit
// after just one of two signers — so recipient-level signature events map to the
// non-terminal `recipient_signed` (recorded, but never completes the agreement), and only
// the document-completion events map to `signed`.
const EVENT_ALIASES: Record<string, AgreementEventType> = {
  document_viewed: "viewed",
  recipient_viewed: "viewed",
  viewed: "viewed",
  document_completed: "signed",
  completed: "signed",
  document_signed: "recipient_signed",
  recipient_signed: "recipient_signed",
  signed: "recipient_signed",
  document_declined: "declined",
  declined: "declined",
  document_canceled: "voided",
  document_cancelled: "voided",
  document_voided: "voided",
  canceled: "voided",
  voided: "voided",
};

interface ParsedEvent {
  type: AgreementEventType;
  documentId: string;
  occurredAt: string;
  eventId: string;
  signedPdfUrl: string | null;
  certificateUrl: string | null;
  /** The SignWell document's test_mode, when present (used for mode-consistency). */
  signwellTestMode: boolean | null;
}

/**
 * Normalize a SignWell time value to an ISO-8601 string. SignWell sends `event.time`
 * as a Unix EPOCH (integer seconds — e.g. 1787990119), not ISO; stored verbatim, Postgres
 * misreads the digits as a year (→ "178799-01-19"). Accept epoch seconds/ms or an already-
 * ISO string; fall back to now for anything unparseable.
 */
export function signwellTimeToIso(t: unknown): string {
  if (typeof t === "number" || (typeof t === "string" && /^\d{9,13}$/.test(t.trim()))) {
    const n = Number(t);
    const ms = n < 1e12 ? n * 1000 : n; // 10-digit → seconds, 13-digit → ms
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof t === "string" && t.trim()) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return nowIso();
}

/** Tolerantly parse a SignWell webhook payload into a normalized event. */
export function parseSignwellEvent(payload: any): ParsedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const rawType = String(payload.event?.type ?? payload.event_type ?? payload.type ?? "").toLowerCase();
  const type = EVENT_ALIASES[rawType];
  if (!type) return null;

  const doc = payload.data?.object ?? payload.data ?? payload.document ?? {};
  const documentId = String(doc.id ?? payload.document_id ?? payload.data?.id ?? "");
  if (!documentId) return null;

  const occurredAt = signwellTimeToIso(payload.event?.time ?? payload.created_at ?? doc.updated_at ?? nowIso());
  const eventId = String(payload.event?.id ?? payload.id ?? `${rawType}:${documentId}:${occurredAt}`);
  const signedPdfUrl = doc.completed_pdf_url ?? doc.signed_pdf_url ?? null;
  const certificateUrl = doc.audit_page_url ?? doc.certificate_url ?? null;
  const signwellTestMode = typeof doc.test_mode === "boolean" ? doc.test_mode : typeof payload.test_mode === "boolean" ? payload.test_mode : null;
  return { type, documentId, occurredAt, eventId, signedPdfUrl, certificateUrl, signwellTestMode };
}

// Monotonic ranking of the FORWARD lifecycle. Terminal side-states (declined,
// voided) are handled separately and only from a non-terminal, non-signed state.
const FORWARD_RANK: Record<AgreementStatus, number> = {
  draft: 0, generated: 1, approved: 2, sent: 3, viewed: 4, signed: 5, declined: 6, voided: 6,
};

/**
 * The target status for an event given the current status, or null if the event
 * should be ignored (stale regression, or already terminal). Pure.
 */
export function nextAgreementStatus(current: AgreementStatus, event: AgreementEventType): AgreementStatus | null {
  if (current === "signed" || current === "declined" || current === "voided") return null; // terminal — ignore
  // A single recipient finishing (document_signed) is NOT completion — it must never
  // advance the agreement to `signed` or unlock the deposit. Recorded upstream for audit,
  // but produces no status transition. Only `document_completed` (event → "signed") does.
  if (event === "recipient_signed") return null;
  if (event === "signed") return "signed";
  if (event === "declined") return "declined";
  if (event === "voided") return "voided";
  if (event === "viewed") {
    // Only advance to viewed from sent (don't regress generated/approved, don't
    // re-apply once past viewed).
    return current === "sent" ? "viewed" : null;
  }
  return null;
}

export type EsignWebhookResult = { ok: boolean; status: number; kind: string; result?: string };

export async function handleSignwellWebhook(input: {
  rawBody: string;
  /** The webhook id used as the HMAC key (SIGNWELL_WEBHOOK_SECRET). */
  secret?: string | null;
  isProduction?: boolean;
}): Promise<EsignWebhookResult> {
  // Parse first — the signature (event.hash) lives inside the body.
  let payload: any;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, status: 400, kind: "bad_json" };
  }

  const secret = input.secret ?? null;
  const ev = payload?.event ?? {};
  if (secret) {
    if (!verifySignwellEventHash(secret, String(ev.type ?? ""), String(ev.time ?? ""), ev.hash ?? null)) {
      return { ok: false, status: 401, kind: "invalid_signature" };
    }
  } else if (input.isProduction) {
    return { ok: false, status: 401, kind: "no_secret" };
  }

  const event = parseSignwellEvent(payload);
  if (!event) return { ok: true, status: 200, kind: "ignored", result: "ignored" };

  const agreement = await getAgreementByEsignRequestId(event.documentId);
  if (!agreement) {
    // Record nothing to apply — unknown document. Ack so SignWell stops retrying.
    return { ok: true, status: 200, kind: event.type, result: "unmatched" };
  }

  // Gate 8: the SignWell document's test_mode MUST agree with the persisted agreement
  // mode (null legacy → test). A mismatch means either a test event is targeting a
  // production agreement or vice-versa — never process it (a test doc must never be able
  // to advance/complete a production agreement or unlock its payment). Fail closed.
  if (event.signwellTestMode != null) {
    const persisted: EsignMode = agreement.esignMode === "production" ? "production" : "test";
    const reason = modeMismatchReason(persisted, event.signwellTestMode);
    if (reason) return { ok: false, status: 409, kind: "mode_mismatch", result: reason };
  }

  // Dedupe on the provider event id, scoped by agreement.
  const dedupeKey = `signwell:${agreement.id}:${event.eventId}`;
  const { inserted } = await insertAgreementEventIfAbsent({
    agreementId: agreement.id,
    provider: "signwell",
    eventType: event.type,
    dedupeKey,
    payload,
    occurredAt: event.occurredAt,
  });
  if (!inserted) return { ok: true, status: 200, kind: event.type, result: "duplicate" };

  const target = nextAgreementStatus(agreement.status, event.type);
  if (!target) return { ok: true, status: 200, kind: event.type, result: "no-op" };

  await applyTransition(agreement, target, event);
  return { ok: true, status: 200, kind: event.type, result: "applied" };
}

async function applyTransition(agreement: Agreement, target: AgreementStatus, event: ParsedEvent): Promise<void> {
  if (target === "viewed") {
    await updateAgreement(agreement.id, { status: "viewed", viewedAt: event.occurredAt });
    return;
  }
  if (target === "declined") {
    await updateAgreement(agreement.id, { status: "declined", declinedAt: event.occurredAt });
    return;
  }
  if (target === "voided") {
    await updateAgreement(agreement.id, { status: "voided", voidedAt: event.occurredAt });
    return;
  }
  if (target === "signed") {
    // 1) Commit the signed state FIRST (with any returned artifacts).
    await updateAgreement(agreement.id, {
      status: "signed",
      signedAt: event.occurredAt,
      signedPdfUrl: event.signedPdfUrl ?? agreement.signedPdfUrl,
      certificateUrl: event.certificateUrl ?? agreement.certificateUrl,
    });
    // 2) Advance the coarse pipeline gate.
    await updateLead(agreement.leadId, { pipelineStage: "Agreement Signed" });
    // 3) Unlock (create) the deposit — pending, NOT sent. Idempotent.
    const existing = await paymentsForAgreement(agreement.id);
    if (!existing.some((p) => p.type === "deposit")) {
      await insertPayment({
        leadId: agreement.leadId,
        agreementId: agreement.id,
        type: "deposit",
        amountCents: agreement.contentSnapshot.depositAmountCents,
        currency: agreement.contentSnapshot.currency,
        status: "pending",
        stripePaymentLinkUrl: null,
        stripeSessionId: null,
        sentAt: null,
        paidAt: null,
      });
    }
  }
}

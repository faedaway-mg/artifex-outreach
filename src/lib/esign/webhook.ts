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
// NOTE FOR PRODUCTION: confirm SignWell's exact signature scheme + event names
// against their current API docs before go-live. The verification here is HMAC-
// SHA256 over the raw body (hex or base64) against SIGNWELL_WEBHOOK_SECRET, and
// the event-name matching is tolerant of the documented variants.
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

const SIGNATURE_HEADER = (process.env.SIGNWELL_WEBHOOK_SIGNATURE_HEADER ?? "x-signwell-signature").toLowerCase();

/** HMAC-SHA256(rawBody, secret) — accept a hex or base64 signature (timing-safe). */
export function verifySignwellSignature(secret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const mac = createHmac("sha256", secret).update(rawBody);
  const digest = mac.digest();
  const candidates = [digest.toString("hex"), digest.toString("base64")];
  const provided = signature.trim();
  for (const expected of candidates) {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export type AgreementEventType = "viewed" | "signed" | "declined" | "voided";

const EVENT_ALIASES: Record<string, AgreementEventType> = {
  document_viewed: "viewed",
  recipient_viewed: "viewed",
  viewed: "viewed",
  document_completed: "signed",
  document_signed: "signed",
  completed: "signed",
  signed: "signed",
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

  const occurredAt = String(payload.event?.time ?? payload.created_at ?? doc.updated_at ?? nowIso());
  const eventId = String(payload.event?.id ?? payload.id ?? `${rawType}:${documentId}:${occurredAt}`);
  const signedPdfUrl = doc.completed_pdf_url ?? doc.signed_pdf_url ?? null;
  const certificateUrl = doc.audit_page_url ?? doc.certificate_url ?? null;
  return { type, documentId, occurredAt, eventId, signedPdfUrl, certificateUrl };
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
  signature: string | null;
  secret?: string | null;
  isProduction?: boolean;
}): Promise<EsignWebhookResult> {
  const secret = input.secret ?? null;
  if (secret) {
    if (!verifySignwellSignature(secret, input.rawBody, input.signature)) {
      return { ok: false, status: 401, kind: "invalid_signature" };
    }
  } else if (input.isProduction) {
    return { ok: false, status: 401, kind: "no_secret" };
  }

  let payload: any;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, status: 400, kind: "bad_json" };
  }

  const event = parseSignwellEvent(payload);
  if (!event) return { ok: true, status: 200, kind: "ignored", result: "ignored" };

  const agreement = await getAgreementByEsignRequestId(event.documentId);
  if (!agreement) {
    // Record nothing to apply — unknown document. Ack so SignWell stops retrying.
    return { ok: true, status: 200, kind: event.type, result: "unmatched" };
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

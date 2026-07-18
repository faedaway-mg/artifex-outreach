// ─────────────────────────────────────────────────────────────────────────────
// Resend webhook ingestion. Verifies the Svix signature, dedupes on the unique
// event id (duplicate deliveries are a no-op), parses the event, records it, and
// applies the resulting state change to the send ledger. State-only — no
// acquisition scoring is touched here (Phase 4). Bounce/complaint/unsubscribe
// suppression is added on top in Phase 6 via onSuppressionEvent.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";
import { insertEmailEventIfAbsent, updateEmailEvent } from "../repo";
import { nowIso } from "../store";
import { applyDeliveryEvent } from "./events";
import { syncSuppressionFromDelivery } from "./suppression-sync";
import type { DeliveryEvent, DeliveryEventType } from "./provider";

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

// Verify a Svix-style signature (Resend's webhook scheme). Secret is "whsec_<b64>".
export function verifySvixSignature(secret: string, headers: SvixHeaders, body: string, opts: { toleranceSec?: number; now?: Date } = {}): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  // Replay guard: reject stale timestamps.
  const tolerance = opts.toleranceSec ?? 300;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - ts) > tolerance) return false;

  const keyB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let key: Buffer;
  try { key = Buffer.from(keyB64, "base64"); } catch { return false; }

  const signed = `${id}.${timestamp}.${body}`;
  const expected = createHmac("sha256", key).update(signed).digest("base64");
  const expectedBuf = Buffer.from(expected);

  // Header is space-separated "v1,<sig>" entries; accept if any matches.
  for (const part of signature.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) return true;
  }
  return false;
}

const TYPE_MAP: Record<string, DeliveryEventType> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.unsubscribed": "unsubscribed",
};

interface ResendPayload {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; created_at?: string };
}

/** Map a Resend webhook payload to a DeliveryEvent, or null if not a state event. */
export function parseResendEvent(payload: ResendPayload): DeliveryEvent | null {
  const type = payload.type ? TYPE_MAP[payload.type] : undefined;
  if (!type) return null; // e.g. email.sent / email.delivery_delayed → ignored
  const providerMessageId = payload.data?.email_id ?? "";
  if (!providerMessageId) return null;
  const at = payload.created_at ?? payload.data?.created_at ?? nowIso();
  return { type, providerMessageId, at };
}

export type WebhookResult = { ok: boolean; status: number; kind: string; result?: string };

/**
 * Full ingestion pipeline for a raw Resend webhook. Verification policy:
 *   • secret set  → signature MUST verify.
 *   • secret unset in production → reject (fail closed).
 *   • secret unset in dev/test → accept (local testing).
 */
export async function handleResendWebhook(input: {
  rawBody: string;
  headers: SvixHeaders;
  secret?: string | null;
  isProduction?: boolean;
  now?: Date;
}): Promise<WebhookResult> {
  const secret = input.secret ?? null;
  if (secret) {
    if (!verifySvixSignature(secret, input.headers, input.rawBody, { now: input.now })) {
      return { ok: false, status: 401, kind: "invalid_signature" };
    }
  } else if (input.isProduction) {
    return { ok: false, status: 401, kind: "no_secret" };
  }

  let payload: ResendPayload;
  try { payload = JSON.parse(input.rawBody) as ResendPayload; } catch { return { ok: false, status: 400, kind: "bad_json" }; }

  // Dedup on the Svix message id (falls back to a synthetic id).
  const providerEventId = input.headers.id ?? `${payload.type ?? "unknown"}:${payload.data?.email_id ?? ""}:${payload.created_at ?? ""}`;
  const event = parseResendEvent(payload);
  const seed = {
    providerEventId,
    type: payload.type ?? "unknown",
    providerMessageId: event?.providerMessageId ?? payload.data?.email_id ?? null,
    sendId: null,
    payload,
    receivedAt: nowIso(),
    processedAt: null as string | null,
    result: null as string | null,
  };
  const { inserted, row } = await insertEmailEventIfAbsent(seed);
  if (!inserted) return { ok: true, status: 200, kind: payload.type ?? "unknown", result: "duplicate" };

  if (!event) {
    await updateEmailEvent(row.id, { processedAt: nowIso(), result: "ignored" });
    return { ok: true, status: 200, kind: payload.type ?? "unknown", result: "ignored" };
  }

  const applied = await applyDeliveryEvent(event);
  // Phase 6: hard bounce / complaint / unsubscribe → suppress (state-only apply
  // above stays purely about the send; this layers on contact suppression).
  await syncSuppressionFromDelivery(event, payload);
  await updateEmailEvent(row.id, { processedAt: nowIso(), result: applied.result, sendId: applied.sendId ?? null });
  return { ok: true, status: 200, kind: event.type, result: applied.result };
}

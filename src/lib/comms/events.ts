// ─────────────────────────────────────────────────────────────────────────────
// Delivery-event application. Translates a provider delivery event into a state
// update on the send ledger — and NOTHING else. It never touches acquisition
// scoring, strategy, or the feedback loop (Phase 4 constraint). Suppression sync
// on bounce/complaint/unsubscribe is layered on separately in Phase 6.
//
// Idempotent + monotonic: applying the same event twice is a no-op, and a late
// "delivered" can never downgrade a send that already "opened"/"clicked".
// ─────────────────────────────────────────────────────────────────────────────
import { getEmailSendByProviderMessageId, updateEmailSend } from "../repo";
import { nowIso } from "../store";
import type { DeliveryEvent, DeliveryEventType } from "./provider";
import type { EmailSend, EmailSendStatus } from "../types";

// Forward-progress ranking. bounced/complained/unsubscribed rank high so they win
// over engagement states (a complaint after an open must be recorded).
const RANK: Record<string, number> = {
  queued: 0, sending: 1, sent: 2, delivered: 3, opened: 4, clicked: 5, bounced: 6, complained: 7, unsubscribed: 8,
};
const STAMP: Record<DeliveryEventType, keyof EmailSend> = {
  delivered: "deliveredAt", opened: "openedAt", clicked: "clickedAt", bounced: "bouncedAt", complained: "complainedAt", unsubscribed: "unsubscribedAt",
};

export type ApplyResult = { result: "applied" | "unmatched"; sendId?: string; status?: EmailSendStatus };

export async function applyDeliveryEvent(e: DeliveryEvent): Promise<ApplyResult> {
  if (!e.providerMessageId) return { result: "unmatched" };
  const send = await getEmailSendByProviderMessageId(e.providerMessageId);
  if (!send) return { result: "unmatched" };

  const patch: Partial<EmailSend> = {};
  const stampField = STAMP[e.type];
  // Stamp the event's own timestamp once (idempotent).
  if (stampField && !(send as any)[stampField]) (patch as any)[stampField] = e.at ?? nowIso();
  // Advance status only forward.
  if ((RANK[e.type] ?? -1) > (RANK[send.status] ?? -1)) patch.status = e.type as EmailSendStatus;

  if (Object.keys(patch).length) {
    const updated = await updateEmailSend(send.id, patch);
    return { result: "applied", sendId: send.id, status: updated?.status };
  }
  return { result: "applied", sendId: send.id, status: send.status };
}

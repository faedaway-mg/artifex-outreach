// ─────────────────────────────────────────────────────────────────────────────
// Suppression sync. Hard bounces, spam complaints, and unsubscribes are pushed
// into the existing suppression system so future sends are automatically blocked
// (dispatchStep re-checks isSuppressed at send time). This protects sender
// reputation and honors opt-outs. It NEVER alters acquisition strategy/scoring —
// it only suppresses contact and stops in-flight sequences.
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, isSuppressed, addSuppression, getEmailSendByProviderMessageId } from "../repo";
import { stopPlansForLead } from "../acquisition/stop";
import type { DeliveryEvent } from "./provider";

/** Idempotently suppress a lead's contact points and stop its live sequences. */
export async function ensureLeadSuppressed(leadId: string, reason: string): Promise<boolean> {
  const lead = await getLead(leadId);
  if (!lead) return false;
  const already = await isSuppressed({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone });
  if (!already) {
    await addSuppression({ email: lead.publicEmail, domain: lead.websiteDomain, phone: lead.phone, reason });
  }
  await stopPlansForLead(leadId, reason);
  return true;
}

interface Bounceish {
  data?: { type?: string; subType?: string; bounce?: { type?: string; subType?: string } };
}
// Hard/permanent bounce → suppress. Soft/transient → don't (let retries continue).
// Unknown → suppress conservatively to protect deliverability.
export function isHardBounce(payload: Bounceish): boolean {
  const d = payload?.data ?? {};
  const t = String(d.bounce?.type ?? d.bounce?.subType ?? d.type ?? d.subType ?? "").toLowerCase();
  if (/soft|transient|temporary|deferred/.test(t)) return false;
  return true;
}

/**
 * Apply suppression for a delivery event, when warranted. Returns true if the lead
 * was (or already is) suppressed as a result.
 */
export async function syncSuppressionFromDelivery(event: DeliveryEvent, payload: unknown): Promise<boolean> {
  const suppressible = event.type === "complained" || event.type === "unsubscribed" || (event.type === "bounced" && isHardBounce(payload as Bounceish));
  if (!suppressible) return false;
  if (!event.providerMessageId) return false;
  const send = await getEmailSendByProviderMessageId(event.providerMessageId);
  if (!send?.leadId) return false;
  return ensureLeadSuppressed(send.leadId, `${event.type} (auto-suppress)`);
}

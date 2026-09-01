// ─────────────────────────────────────────────────────────────────────────────
// Canonical commercial-message assembler (Phase 2). ONE source of truth for the CAN-SPAM footer that
// every cold-outreach path must include, in BOTH HTML and plain text:
//   • legal sender identity (Artifex Labs Systems LLC)
//   • a truthful "this is business outreach / a commercial message" statement
//   • the EXACT runtime COMMS_POSTAL_ADDRESS (never committed / never invented)
//   • a visible one-click unsubscribe link + the plain-text unsubscribe URL, bound to a hardened,
//     recipient-specific signed token
// FAIL CLOSED (returns {ok:false, reason}) when any required piece is missing, so a non-compliant
// message can never be assembled — and therefore never sent.
// ─────────────────────────────────────────────────────────────────────────────
import { validEmail } from "../acquisition/compliance";
import { mintUnsubToken } from "./unsubscribe-token";

export const LEGAL_IDENTITY = "Artifex Labs Systems LLC";

/** The postal address for the CAN-SPAM footer. The deployment-level COMMS_POSTAL_ADDRESS wins; when it
 *  is unset, the operator-configured Settings "Business mailing address" (`fallback`) is used, so the
 *  compliant footer can assemble without a redeploy. Never invented — one of the two must be present. */
function postalAddress(fallback?: string): string {
  const env = (process.env.COMMS_POSTAL_ADDRESS ?? "").trim();
  return env || (fallback ?? "").trim();
}
function publicBase(): string | null {
  const b = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  return b ? b.replace(/\/+$/, "") : null;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The hardened, recipient-bound public unsubscribe URL (or null if unbuildable → fail closed). */
export function unsubscribeUrl(leadId: string, recipientEmail: string): string | null {
  const base = publicBase();
  const token = mintUnsubToken(leadId, recipientEmail);
  if (!base || !token) return null;
  return `${base}/api/comms/unsubscribe?lead=${encodeURIComponent(leadId)}&t=${token}`;
}

export type FooterFailReason = "no-postal" | "no-identity" | "invalid-recipient" | "no-unsubscribe-url";
export interface CommercialFooter { html: string; text: string; unsubscribeUrl: string; }

/**
 * Build the compliant footer for (leadId, recipient). FAIL CLOSED when the postal address, identity,
 * a valid recipient, or an unsubscribe URL (needs COMMS_UNSUBSCRIBE_SECRET + a public base) is absent.
 */
export function buildCommercialFooter(input: { leadId: string; recipient: string; postal?: string }): { ok: true; footer: CommercialFooter } | { ok: false; reason: FooterFailReason } {
  if (!validEmail(input.recipient)) return { ok: false, reason: "invalid-recipient" };
  if (!LEGAL_IDENTITY) return { ok: false, reason: "no-identity" };
  const postal = postalAddress(input.postal);
  if (!postal) return { ok: false, reason: "no-postal" };
  const url = unsubscribeUrl(input.leadId, input.recipient);
  if (!url) return { ok: false, reason: "no-unsubscribe-url" };

  const html =
    `<div style="margin-top:18px;padding-top:10px;border-top:1px solid #e6e0d5;color:#8a8175;font-size:11.5px;line-height:1.6;">` +
    `${esc(LEGAL_IDENTITY)} sent this business outreach to ${esc(input.recipient)}. This is a commercial message. ` +
    `If you do not want further outreach from Artifex Labs, <a href="${esc(url)}" style="color:#8a8175;text-decoration:underline;">unsubscribe here</a>.<br>` +
    `${esc(LEGAL_IDENTITY)} · ${esc(postal)}` +
    `</div>`;
  const text =
    `\n\n— \n${LEGAL_IDENTITY} sent this business outreach to ${input.recipient}. This is a commercial message.\n` +
    `If you do not want further outreach from Artifex Labs, unsubscribe: ${url}\n` +
    `${LEGAL_IDENTITY} · ${postal}`;

  return { ok: true, footer: { html, text, unsubscribeUrl: url } };
}

/** Assemble the full commercial message (append the footer to the body). Fail-closed via the footer. */
export function assembleCommercialMessage(input: { leadId: string; recipient: string; subject: string; bodyHtml: string; bodyText: string; postal?: string }):
  | { ok: true; html: string; text: string; unsubscribeUrl: string }
  | { ok: false; reason: FooterFailReason | "no-subject" } {
  if (!input.subject || !input.subject.trim()) return { ok: false, reason: "no-subject" };
  const f = buildCommercialFooter({ leadId: input.leadId, recipient: input.recipient, postal: input.postal });
  if (!f.ok) return f;
  return { ok: true, html: `${input.bodyHtml}${f.footer.html}`, text: `${input.bodyText}${f.footer.text}`, unsubscribeUrl: f.footer.unsubscribeUrl };
}

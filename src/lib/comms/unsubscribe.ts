// One-click unsubscribe link support. A link is only produced when a public base
// URL and signing secret are configured; otherwise the rendered email falls back
// to a reply-based opt-out (still compliant). The HMAC token lets the public
// endpoint (Phase 6) verify an opt-out without auth and without a DB lookup.
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string | null {
  return process.env.AUTH_SECRET || process.env.CRON_SECRET || null;
}
function publicBase(): string | null {
  const b = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL;
  return b ? b.replace(/\/+$/, "") : null;
}

export function unsubscribeToken(leadId: string): string | null {
  const s = secret();
  if (!s) return null;
  return createHmac("sha256", s).update(`unsub:${leadId}`).digest("hex");
}

export function unsubscribeUrlFor(leadId: string): string | null {
  const base = publicBase();
  const token = unsubscribeToken(leadId);
  if (!base || !token) return null;
  return `${base}/api/comms/unsubscribe?lead=${encodeURIComponent(leadId)}&token=${token}`;
}

/**
 * RFC 8058 one-click unsubscribe headers for the outbound message. A signed HTTPS
 * link (when configured) enables Gmail/Yahoo one-click; a mailto is always
 * included as a fallback. Required for bulk-sender deliverability compliance.
 */
export function listUnsubscribeHeaders(leadId: string, replyEmail: string): Record<string, string> {
  const url = unsubscribeUrlFor(leadId);
  const parts: string[] = [];
  if (url) parts.push(`<${url}>`);
  parts.push(`<mailto:${replyEmail}?subject=unsubscribe>`);
  const headers: Record<string, string> = { "List-Unsubscribe": parts.join(", ") };
  // One-Click is only valid alongside an HTTPS unsubscribe that accepts POST.
  if (url) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  return headers;
}

export function verifyUnsubscribeToken(leadId: string, token: string): boolean {
  const expected = unsubscribeToken(leadId);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

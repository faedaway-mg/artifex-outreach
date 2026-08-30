// ─────────────────────────────────────────────────────────────────────────────
// Hardened, signed one-click unsubscribe token (Phase 3). Uses a DEDICATED secret
// (COMMS_UNSUBSCRIBE_SECRET) — never the Graph credentials or the session secret. The token binds:
//   • a  — authorization/lead id (who the message was for)
//   • e  — an opaque HMAC of the normalized recipient email (recipient-substitution guard; no raw
//           email in the URL, no address enumeration)
//   • iat — issued-at (seconds) for the validity window
//   • v  — token version   • p — purpose/audience
// Verification is constant-time and rejects tampering / wrong version / wrong purpose. An EXPIRED
// token may block a NEW opt-out, but it NEVER reverses a suppression already on record.
// Pure crypto — fully unit-testable, no I/O.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";

export const UNSUB_TOKEN_VERSION = 1;
export const UNSUB_PURPOSE = "outreach-unsub";
// 60 days: comfortably beyond the ≥30-day commercial-email requirement.
export const UNSUB_MAX_AGE_SECONDS = 60 * 24 * 60 * 60;

function secret(): string | null {
  return process.env.COMMS_UNSUBSCRIBE_SECRET || null;
}
export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}
/** Opaque, deterministic recipient identifier (keyed HMAC) — binds the token to THIS recipient without
 *  putting the address in the URL. Requires the secret; returns null when unconfigured (fail closed). */
export function recipientHmac(email: string): string | null {
  const s = secret();
  if (!s) return null;
  return createHmac("sha256", s).update(`rid:${normalizeEmail(email)}`).digest("base64url").slice(0, 24);
}

interface Payload { a: string; e: string; iat: number; v: number; p: string }

/** Mint a token for (leadId, recipient). Returns null when the secret is missing (fail closed). */
export function mintUnsubToken(leadId: string, recipientEmail: string, nowSec?: number): string | null {
  const s = secret();
  const e = recipientHmac(recipientEmail);
  if (!s || !e || !leadId) return null;
  const payload: Payload = { a: leadId, e, iat: nowSec ?? Math.floor(Date.now() / 1000), v: UNSUB_TOKEN_VERSION, p: UNSUB_PURPOSE };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", s).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export interface UnsubVerify { ok: boolean; leadId?: string; recipientHmac?: string; iat?: number; expired?: boolean; reason?: string }

/** Verify signature + version + purpose (constant-time). `expired` is reported separately so callers
 *  can still refuse a NEW opt-out on an old link while never reversing an existing suppression. */
export function verifyUnsubToken(token: string, nowSec?: number): UnsubVerify {
  const s = secret();
  if (!s) return { ok: false, reason: "unsubscribe not configured" };
  if (!token || typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "malformed" };
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", s).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
  let p: Payload;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { ok: false, reason: "malformed payload" }; }
  if (p.v !== UNSUB_TOKEN_VERSION) return { ok: false, reason: "wrong version" };
  if (p.p !== UNSUB_PURPOSE) return { ok: false, reason: "wrong purpose" };
  if (!p.a || !p.e || typeof p.iat !== "number") return { ok: false, reason: "incomplete payload" };
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const expired = now - p.iat > UNSUB_MAX_AGE_SECONDS;
  return { ok: true, leadId: p.a, recipientHmac: p.e, iat: p.iat, expired };
}

/** True iff the token was issued for this exact recipient (substitution guard) — recompute + compare. */
export function tokenMatchesRecipient(tokenRecipientHmac: string, recipientEmail: string): boolean {
  const cur = recipientHmac(recipientEmail);
  if (!cur || !tokenRecipientHmac) return false;
  const a = Buffer.from(cur), b = Buffer.from(tokenRecipientHmac);
  return a.length === b.length && timingSafeEqual(a, b);
}

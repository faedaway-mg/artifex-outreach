// Session token sign/verify (node crypto only — no next/headers import, so it is
// unit-testable and reusable). HMAC-signed, expiring token: base64url(payload).sig
import { createHmac, timingSafeEqual } from "crypto";
import { DEV_SECRET, SESSION_MAX_AGE_MS } from "./auth-config";

function secret(): string {
  return process.env.AUTH_SECRET ?? DEV_SECRET;
}

export function signToken(subject: string): string {
  const payload = `${subject}.${Date.now()}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

/**
 * The operator this token was issued to. Returns null when the token is missing,
 * tampered with, or expired — identity and validity are never separated.
 *
 * The payload is `${subject}.${issuedAt}`, so the subject must not contain a dot.
 * Operator ids are slugs, which is enforced where operators are created.
 */
export function tokenSubject(token: string | undefined): string | null {
  if (!verifyToken(token)) return null;
  try {
    const payload = Buffer.from(token!.split(".")[0], "base64url").toString();
    const subject = payload.slice(0, payload.lastIndexOf("."));
    return subject || null;
  } catch {
    return null;
  }
}

/**
 * When a valid token was issued, in epoch ms — or null.
 *
 * Callers that need a SHORTER life than the session (impersonation is a visit,
 * not a move) apply their own window on top of this rather than minting a second
 * token format with its own expiry rules.
 */
export function tokenIssuedAt(token: string | undefined): number | null {
  if (!verifyToken(token)) return null;
  try {
    const payload = Buffer.from(token!.split(".")[0], "base64url").toString();
    const issued = Number(payload.slice(payload.lastIndexOf(".") + 1));
    return Number.isFinite(issued) && issued > 0 ? issued : null;
  } catch {
    return null;
  }
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return false;
  try {
    const payload = Buffer.from(b64, "base64url").toString();
    const expected = createHmac("sha256", secret()).update(payload).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    // Read the timestamp from the LAST dot, matching tokenSubject. The two must
    // agree about where the subject ends or a token could verify as one operator
    // and expire as another.
    const issued = Number(payload.slice(payload.lastIndexOf(".") + 1));
    if (!issued || Date.now() - issued > SESSION_MAX_AGE_MS) return false;
    return true;
  } catch {
    return false;
  }
}

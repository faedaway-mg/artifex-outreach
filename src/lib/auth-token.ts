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
    const issued = Number(payload.split(".")[1]);
    if (!issued || Date.now() - issued > SESSION_MAX_AGE_MS) return false;
    return true;
  } catch {
    return false;
  }
}

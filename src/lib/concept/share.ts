import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// A share token is a long unguessable value; we persist only its SHA-256 hash.
// The raw token is shown once at creation and never stored.
export function generateShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url"); // 256-bit
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatchesHash(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Edge-runtime-safe session verification (Web Crypto). Mirrors the token format
// produced by lib/auth.signToken so the middleware can gate routes.
const SESSION_COOKIE = "artifex_session";

function secret(): string {
  return process.env.AUTH_SECRET ?? "artifex-outreach-dev-secret";
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  // atob is available in the Edge runtime
  return atob(b64);
}

export async function verifyTokenEdge(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return false;
  try {
    const payload = b64urlDecode(b64);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    if (toHex(mac) !== sig) return false;
    const issued = Number(payload.split(".")[1]);
    const MAX_AGE = 1000 * 60 * 60 * 24 * 14; // 14 days — must match lib/auth
    if (!issued || Date.now() - issued > MAX_AGE) return false;
    return true;
  } catch {
    return false;
  }
}

export { SESSION_COOKIE };

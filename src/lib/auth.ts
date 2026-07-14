// ─────────────────────────────────────────────────────────────────────────────
// Single-operator auth for an internal tool. A signed, expiring, HTTP-only cookie
// gates every route. In PRODUCTION the dev defaults are rejected: OUTREACH_PASSWORD
// and AUTH_SECRET are required and must be non-default and of sufficient length.
// ─────────────────────────────────────────────────────────────────────────────
import { cookies } from "next/headers";
import { DEV_PASSWORD, SESSION_MAX_AGE_MS, isProd, assertAuthConfigured, authConfigOk } from "./auth-config";
import { signToken, verifyToken } from "./auth-token";

const COOKIE = "artifex_session";

export { assertAuthConfigured, authConfigOk, signToken, verifyToken };

export function expectedPassword(): string {
  return process.env.OUTREACH_PASSWORD ?? DEV_PASSWORD;
}

export function usingDevPassword(): boolean {
  return !process.env.OUTREACH_PASSWORD && !isProd();
}

export function setSession(): void {
  cookies().set(COOKIE, signToken("jordan"), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
}

export function clearSession(): void {
  cookies().delete(COOKIE);
}

export function isAuthenticated(): boolean {
  return verifyToken(cookies().get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = SESSION_MAX_AGE_MS;

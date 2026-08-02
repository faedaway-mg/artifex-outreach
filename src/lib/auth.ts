// ─────────────────────────────────────────────────────────────────────────────
// Single-operator auth for an internal tool. A signed, expiring, HTTP-only cookie
// gates every route. In PRODUCTION the dev defaults are rejected: OUTREACH_PASSWORD
// and AUTH_SECRET are required and must be non-default and of sufficient length.
// ─────────────────────────────────────────────────────────────────────────────
import { cookies } from "next/headers";
import { DEV_PASSWORD, SESSION_MAX_AGE_MS, isProd, assertAuthConfigured, authConfigOk } from "./auth-config";
import { signToken, verifyToken, tokenSubject } from "./auth-token";
import { LEGACY_OPERATOR_ID } from "./operators/model";
import { impersonatedOperatorId, impersonationStartedAt, endImpersonation } from "./impersonation";
import type { ViewerContext } from "./impersonation";

const COOKIE = "artifex_session";

export { assertAuthConfigured, authConfigOk, signToken, verifyToken, tokenSubject };

export function expectedPassword(): string {
  return process.env.OUTREACH_PASSWORD ?? DEV_PASSWORD;
}

export function usingDevPassword(): boolean {
  return !process.env.OUTREACH_PASSWORD && !isProd();
}

/**
 * Start a session for a specific operator. The token format already carried a
 * subject — it was simply always "jordan". Passing the real operator id is the
 * whole of the identity change; nothing about the wire format moves.
 */
export function setSession(operatorId: string = LEGACY_OPERATOR_ID): void {
  cookies().set(COOKIE, signToken(operatorId), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
}

export function clearSession(): void {
  cookies().delete(COOKIE);
  // Signing out must not leave a "view as" pointing at a colleague, waiting for
  // whoever signs in next.
  endImpersonation();
}

export function isAuthenticated(): boolean {
  return verifyToken(cookies().get(COOKIE)?.value);
}

/**
 * Whose workspace is on screen. Falls back to the legacy operator so that a
 * session issued before operators existed keeps working instead of failing closed
 * on a tool the business runs on every morning.
 *
 * While a manager is viewing as someone else this returns the OTHER operator —
 * that is the entire point: the queue, the counts and the pages must be theirs.
 * What it must never do is change who a write is credited to; that is
 * currentActor(), and the two have been separate since operators existed.
 */
export function currentOperatorId(): string {
  return impersonatedOperatorId() ?? sessionSubject() ?? LEGACY_OPERATOR_ID;
}

/** The human at the keyboard, ignoring any "view as". */
export function realOperatorId(): string | null {
  return sessionSubject();
}

/** Who is on screen, who is actually here, and whether those differ. */
export function viewerContext(): ViewerContext {
  const real = sessionSubject();
  const viewed = impersonatedOperatorId();
  return {
    realOperatorId: real,
    effectiveOperatorId: viewed ?? real,
    impersonating: Boolean(viewed && viewed !== real),
    startedAt: viewed ? impersonationStartedAt() : null,
  };
}

/**
 * Who to attribute a write to. Unlike currentOperatorId this does NOT invent a
 * person when there is no session — unattended work is recorded as "system"
 * rather than silently credited to an operator who was not there. With two
 * operators that difference stops being cosmetic.
 *
 * It also deliberately ignores impersonation. A manager working inside someone
 * else's queue is still the one who did it, and the audit log will say so.
 */
export function currentActor(): string {
  return sessionSubject() ?? "system";
}

function sessionSubject(): string | null {
  try {
    return tokenSubject(cookies().get(COOKIE)?.value);
  } catch {
    // Outside a request scope (scripts, background work) there is no session.
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = SESSION_MAX_AGE_MS;

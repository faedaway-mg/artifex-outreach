// ─────────────────────────────────────────────────────────────────────────────
// "View as" — temporary delegated operation.
//
// A manager sometimes has to stand at someone else's desk: to train them, to see
// the bug they are describing, to clear a queue while they are out. The honest
// way to build that is NOT to hand the manager the other person's session. It is
// to keep two identities on the request at once and never confuse them:
//
//     who am I LOOKING at ...... currentOperatorId()   → the impersonated operator
//     who is DOING this ........ currentActor()        → always the real manager
//
// That seam already existed. auth.ts has drawn the distinction since the day
// operators were introduced — currentOperatorId() invents a person when there is
// no session, currentActor() refuses to. Impersonation is not a new concept in
// this codebase; it is the second reason that distinction was worth having.
//
// The consequence matters: while a manager is viewing as Alex, the queue, the
// counts and the pages are Alex's, and every row written is attributed to the
// manager. Nothing in the audit log will ever claim Alex did something he did not.
//
// The impersonation cookie is SEPARATE from the session cookie and short-lived.
// Separate, because dropping it must never sign anyone out. Short-lived, because
// standing at someone's desk is a visit, not a move — 60 minutes, then it lapses
// on its own whether or not anyone remembered to leave.
// ─────────────────────────────────────────────────────────────────────────────
import { cookies } from "next/headers";
import { isProd } from "./auth-config";
import { signToken, tokenSubject, tokenIssuedAt } from "./auth-token";

const COOKIE = "artifex_viewing_as";

/** A visit, not a move. */
export const IMPERSONATION_MAX_AGE_MS = 60 * 60 * 1000;

export interface ViewerContext {
  /** The human at the keyboard. Every write is attributed to this id. */
  realOperatorId: string | null;
  /** Whose workspace is on screen. Equals realOperatorId when not impersonating. */
  effectiveOperatorId: string | null;
  impersonating: boolean;
  /** When the current impersonation began, ISO. Null when not impersonating. */
  startedAt: string | null;
}

/**
 * Begin operating as another operator.
 *
 * Deliberately dumb: it writes a signed cookie and nothing else. Whether this is
 * ALLOWED is a roles question (roles.canImpersonate) and an audit question, and
 * both are answered by the caller — this module must not become a second, weaker
 * copy of the permission rules.
 */
export function beginImpersonation(targetOperatorId: string): void {
  cookies().set(COOKIE, signToken(targetOperatorId), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    maxAge: Math.floor(IMPERSONATION_MAX_AGE_MS / 1000),
  });
}

export function endImpersonation(): void {
  cookies().delete(COOKIE);
}

/**
 * The operator currently being viewed as, or null.
 *
 * Verifies the signature and applies the SHORTER 60-minute expiry itself: the
 * token's own 14-day window is the session's, and reusing it here would quietly
 * turn a visit into a move.
 */
export function impersonatedOperatorId(): string | null {
  try {
    const raw = cookies().get(COOKIE)?.value;
    const subject = tokenSubject(raw);
    if (!subject) return null;
    const issued = tokenIssuedAt(raw);
    if (issued == null || Date.now() - issued > IMPERSONATION_MAX_AGE_MS) return null;
    return subject;
  } catch {
    // Outside a request scope (scripts, cron) nobody is impersonating anyone.
    return null;
  }
}

/** When the current impersonation began, or null. */
export function impersonationStartedAt(): string | null {
  try {
    const issued = tokenIssuedAt(cookies().get(COOKIE)?.value);
    if (issued == null || Date.now() - issued > IMPERSONATION_MAX_AGE_MS) return null;
    return new Date(issued).toISOString();
  } catch {
    return null;
  }
}

export const IMPERSONATION_COOKIE = COOKIE;

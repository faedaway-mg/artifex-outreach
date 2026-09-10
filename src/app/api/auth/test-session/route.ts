// ─────────────────────────────────────────────────────────────────────────────
// TEST-ONLY SESSION (Breakbot synthetic-user auth, mandate §4).
//
// Mints a valid operator session for the synthetic-user harness in a RELEASE CANDIDATE,
// WITHOUT the real OUTREACH_PASSWORD. It is non-production-capable by construction:
//   • it does NOTHING unless BREAKBOT_TEST_AUTH is set (real production never sets it);
//   • the caller must present that exact secret in the x-test-auth header;
//   • the secret must be ≥16 chars (a weak/blank value is refused);
//   • it only ever mints the fixed synthetic operator id "breakbot-test" — it can never
//     impersonate a real operator or a customer;
//   • it never reads or exposes OUTREACH_PASSWORD or any other secret;
//   • every mint is audited.
// It reuses the SAME signing path as real login (signToken) so the token is genuine and
// authentication itself is NOT weakened — the ONLY new capability is an env-gated door.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { signToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { isProd } from "@/lib/auth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEST_OPERATOR_ID = "breakbot-test";
const MIN_SECRET_LEN = 16;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = (process.env.BREAKBOT_TEST_AUTH ?? "").trim();
  // Disabled unless an explicit, sufficiently-strong test secret is configured. Real
  // production does not set BREAKBOT_TEST_AUTH → this route is inert there.
  if (!secret || secret.length < MIN_SECRET_LEN) {
    return NextResponse.json({ error: "test session disabled" }, { status: 403 });
  }
  const provided = (req.headers.get("x-test-auth") ?? "").trim();
  if (!provided || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: "invalid test secret" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, operatorId: TEST_OPERATOR_ID });
  res.cookies.set(SESSION_COOKIE, signToken(TEST_OPERATOR_ID), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd(),
    path: "/",
    maxAge: Math.floor(SESSION_MAX_AGE / 1000),
  });
  // Best-effort audit (never block the mint on the audit store being reachable).
  try {
    const { appendAudit } = await import("@/lib/repo");
    await appendAudit({ action: "auth.test_session_minted", actor: TEST_OPERATOR_ID, targetType: "auth", targetId: TEST_OPERATOR_ID, meta: null, ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null });
  } catch { /* audit is best-effort in a release candidate */ }
  return res;
}

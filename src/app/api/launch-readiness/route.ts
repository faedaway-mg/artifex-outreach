import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getSettings } from "@/lib/repo";
import { computeLaunchReadiness } from "@/lib/launch/launch-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth-gated GO / NO-GO launch-readiness report + send-infrastructure audit. This
// endpoint is DIAGNOSTIC ONLY: it never sends, never charges, and returns BOOLEAN /
// enum facts only — no secret, no From address, and no test-recipient address.
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Settings supply the From/postal FALLBACK presence (never the values); a read failure
  // must not crash the diagnostic, so we degrade to env-only.
  const settings = await getSettings().catch(() => null);
  const readiness = await computeLaunchReadiness(process.env, settings);

  return NextResponse.json({
    state: readiness.state,
    generatedAt: readiness.generatedAt,
    blockers: readiness.blockers,
    checks: readiness.checks,
    audit: readiness.audit,
  });
}

import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { prospectLanesView } from "@/lib/comms/google-workspace/prospect-lanes";
import { BUSINESS_MAILBOX } from "@/lib/transport/prospect-transport-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Auth-gated transport-architecture read-model for the operator dashboard. It answers
// "which mail system does which job": the two Google Workspace prospect lanes (A/B),
// the Resend transactional presence, and the constant Microsoft 365 business mailbox.
// DIAGNOSTIC ONLY — it never sends. Returns BOOLEANS / non-secret addresses / counters
// only; no API key, refresh token, or client secret value is ever read or returned.
export async function GET() {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const prospect = await prospectLanesView();

  return NextResponse.json({
    prospect,
    // Presence only — the RESEND_API_KEY value is never read or returned.
    transactional: { provider: "resend" as const, configured: !!process.env.RESEND_API_KEY },
    businessMailbox: { address: BUSINESS_MAILBOX.address, provider: BUSINESS_MAILBOX.provider },
  });
}

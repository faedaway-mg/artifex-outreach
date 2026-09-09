import { NextRequest, NextResponse } from "next/server";
import { commsMetrics } from "@/lib/comms/monitoring";
import { googleConfigPresence } from "@/lib/comms/google-workspace/config";
import { senderHealthSnapshot } from "@/lib/comms/google-workspace/sender-health";
import { stripeModeDiagnostics } from "@/lib/quick-fix/stripe-mode";
import { webhookSecretPresence } from "@/lib/quick-fix/webhook-secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operational metrics for the communication layer. Guarded by CRON_SECRET so an
// external monitor can poll it. Pass ?health=1 to include a live provider ping.
// The Google transport diagnostics report PRESENCE ONLY — booleans + non-secret
// mailbox addresses + per-sender counters. No credential value is ever included.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const includeProviderHealth = req.nextUrl.searchParams.get("health") === "1";
  const [metrics, senders] = await Promise.all([commsMetrics({ includeProviderHealth }), senderHealthSnapshot()]);
  const google = { ...googleConfigPresence(), senderHealth: senders };
  // Quick-Fix Stripe diagnostics — booleans + resolved mode ONLY (no key/secret values).
  const quickFixStripe = { ...stripeModeDiagnostics(), ...webhookSecretPresence() };
  return NextResponse.json({ ok: true, metrics, google, quickFixStripe });
}

import { NextRequest, NextResponse } from "next/server";
import { handleResendWebhook } from "@/lib/comms/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resend delivery webhooks (delivered/opened/clicked/bounced/complained/…). The
// raw body is required for signature verification, so we read text() not json().
// Duplicate deliveries are idempotent. Always 200 on a validly-signed event so the
// provider does not needlessly retry; 401 only on signature/secret failures.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const result = await handleResendWebhook({
    rawBody,
    headers: {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    secret: process.env.RESEND_WEBHOOK_SECRET ?? null,
    isProduction: process.env.NODE_ENV === "production",
  });
  return NextResponse.json({ ok: result.ok, kind: result.kind, result: result.result }, { status: result.status });
}

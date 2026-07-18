import { NextRequest, NextResponse } from "next/server";
import { handleInboundWebhook } from "@/lib/comms/reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inbound email (prospect replies), delivered by the provider as a parsed webhook.
// Raw body is required for signature verification. Replies are classified and
// stored (raw content preserved); a genuine human reply stops the sequence.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const result = await handleInboundWebhook({
    rawBody,
    headers: {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    secret: process.env.RESEND_WEBHOOK_SECRET ?? null,
    isProduction: process.env.NODE_ENV === "production",
  });
  return NextResponse.json({ ok: result.ok, kind: result.kind, classification: result.classification, result: result.result }, { status: result.status });
}

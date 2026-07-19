import { NextRequest, NextResponse } from "next/server";
import { handleSignwellWebhook } from "@/lib/esign/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNATURE_HEADER = (process.env.SIGNWELL_WEBHOOK_SIGNATURE_HEADER ?? "x-signwell-signature").toLowerCase();

// SignWell e-sign webhooks (viewed / completed / declined / canceled). The raw
// body is required for signature verification, so we read text() not json().
// Self-authenticating (allowlisted in middleware). 200 on any validly-handled
// event so SignWell does not needlessly retry; 401 only on signature/secret fail.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const result = await handleSignwellWebhook({
    rawBody,
    signature: req.headers.get(SIGNATURE_HEADER),
    secret: process.env.SIGNWELL_WEBHOOK_SECRET ?? null,
    isProduction: process.env.NODE_ENV === "production",
  });
  return NextResponse.json({ ok: result.ok, kind: result.kind, result: result.result }, { status: result.status });
}

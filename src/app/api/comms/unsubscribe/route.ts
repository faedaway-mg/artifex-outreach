import { NextRequest, NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/comms/unsubscribe";
import { ensureLeadSuppressed } from "@/lib/comms/suppression-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public one-click unsubscribe (linked from outbound emails). No auth — the HMAC
// token authorizes the specific lead. Idempotent: repeat clicks stay unsubscribed.
// Supports GET (link click) and POST (RFC 8058 one-click list-unsubscribe).
async function handle(req: NextRequest) {
  const lead = req.nextUrl.searchParams.get("lead");
  const token = req.nextUrl.searchParams.get("token");
  if (!lead || !token || !verifyUnsubscribeToken(lead, token)) {
    return NextResponse.json({ ok: false, error: "invalid or missing token" }, { status: 400 });
  }
  await ensureLeadSuppressed(lead, "One-click unsubscribe (auto-suppress)");
  return new NextResponse("You have been unsubscribed. You will not receive further emails.", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const GET = handle;
export const POST = handle;

import { NextRequest, NextResponse } from "next/server";
import { getLead } from "@/lib/repo";
import { verifyUnsubscribeToken } from "@/lib/comms/unsubscribe";
import { verifyUnsubToken, tokenMatchesRecipient } from "@/lib/comms/unsubscribe-token";
import { suppressAndCascade } from "@/lib/comms/suppression";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public one-click unsubscribe. No auth, no login, no explanation — a signed token authorizes the
// opt-out. Idempotent. Supports GET (link click) and POST (RFC 8058 one-click). Accepts the hardened
// token `t` (recipient-bound; preferred) or the legacy `token` (links already in the wild). On success:
// permanent GLOBAL suppression + cascade-cancel of scheduled messages and follow-ups.
const CONFIRM = "You have been unsubscribed and will not receive further outreach from Artifex Labs.";
const ok = () => new NextResponse(CONFIRM, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const bad = () => NextResponse.json({ ok: false, error: "invalid or missing token" }, { status: 400 });

async function handle(req: NextRequest) {
  const leadId = req.nextUrl.searchParams.get("lead");
  const hardened = req.nextUrl.searchParams.get("t");
  const legacy = req.nextUrl.searchParams.get("token");
  if (!leadId) return bad();

  if (hardened) {
    const v = verifyUnsubToken(hardened);
    if (!v.ok || v.leadId !== leadId) return bad();
    const lead = await getLead(leadId);
    const email = lead?.publicEmail ?? "";
    // Recipient-substitution guard: the token must have been issued for THIS lead's current address.
    if (!email || !tokenMatchesRecipient(v.recipientHmac!, email)) return bad();
    // Expiry never REVERSES suppression; we still honor an opt-out (always safe) and note it.
    await suppressAndCascade({ email, leadId, status: "UNSUBSCRIBED", source: v.expired ? "one-click-expired-token" : "one-click", tokenVersion: 1 });
    return ok();
  }

  // Legacy token (leadId-bound). Still honored so links already sent keep working.
  if (legacy && verifyUnsubscribeToken(leadId, legacy)) {
    const lead = await getLead(leadId);
    if (lead?.publicEmail) await suppressAndCascade({ email: lead.publicEmail, leadId, status: "UNSUBSCRIBED", source: "one-click-legacy" });
    return ok(); // idempotent even if the address is already gone
  }
  return bad();
}

export const GET = handle;
export const POST = handle;

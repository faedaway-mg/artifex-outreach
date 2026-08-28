import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getShare, isLive, buildShareEmail } from "@/lib/content-studio/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → PREPARE the outreach email for an approved, live share (subject/body/HTML with a clickable
// thumbnail linking to the viewing page). Preparing does NOT send. If the share is missing/revoked the
// prepare is blocked (so no broken link is ever composed).
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const share = await getShare(params.token);
  if (!share) return NextResponse.json({ error: "share not found" }, { status: 404 });
  if (!isLive(share)) return NextResponse.json({ error: "This viewing link is revoked — re-create it before preparing an email." }, { status: 409 });
  let body: any = {}; try { body = await req.json(); } catch {}
  const base = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
  const email = buildShareEmail(share, { baseUrl: base, recipientName: body?.recipientName ?? null });
  return NextResponse.json({
    businessId: share.businessId, businessName: share.businessName,
    subject: email.subject, text: email.text, html: email.html, viewUrl: email.viewUrl,
    attachesMp4: false, embedsPlayer: false, videoHash: share.videoHash.slice(0, 12),
    note: "Prepared only — nothing sent. Send it through the existing manual-email workflow (preview → approve → explicit Send). No MP4 is attached.",
  });
}

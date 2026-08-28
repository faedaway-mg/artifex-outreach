import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { revokeShare } from "@/lib/content-studio/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → revoke a viewing link. The page + media route then return "unavailable". (Already-downloaded
// copies cannot be recalled — see the operator note in the UI.)
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await revokeShare(params.token);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, revokedAt: new Date().toISOString() });
}

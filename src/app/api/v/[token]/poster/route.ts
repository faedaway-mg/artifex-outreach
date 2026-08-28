import { NextRequest, NextResponse } from "next/server";
import { statSync, existsSync, readFileSync } from "node:fs";
import { getShare, isLive, sharePosterPath } from "@/lib/content-studio/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC: the FROZEN, version-bound poster for a live share (shown before playback). Token-gated + goes
// away on revoke — a revoked/unknown share cannot expose the image through this route either.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const share = await getShare(params.token);
  if (!share || !isLive(share)) return new NextResponse("unavailable", { status: 410, headers: { "X-Robots-Tag": "noindex" } });
  const file = sharePosterPath(params.token);
  if (!existsSync(file)) return new NextResponse("no poster", { status: 404 });
  const body = readFileSync(file);
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": String(statSync(file).size), "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex" } });
}

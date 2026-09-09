import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";
import { resolvePersonalizedVideoForServe } from "@/lib/quick-fix/personalized-video-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// CUSTOMER-FACING PERSONALIZED VIDEO CAPTIONS (text/vtt). Same gate + currency rules.
// Captions are served only when the render is READY AND captions were verified verbatim
// (captionsVerified) — an unverified transcript is never exposed.
export async function GET(_req: NextRequest, { params }: { params: { offerId: string } }) {
  const res = await resolvePersonalizedVideoForServe(params.offerId, { operator: isAuthenticated() });
  if (!res.ok || !res.record?.captionsKey || !res.record.captionsVerified) {
    return new NextResponse("Not found", { status: res.httpStatus === 200 ? 404 : res.httpStatus });
  }
  const meta = await getArtifactStore().getMeta(res.record.captionsKey);
  if (!meta) return new NextResponse("Not found", { status: 404 });
  const full = await getArtifactStore().readFull(res.record.captionsKey);
  if (!full) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(bin(full), {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      ETag: `"${meta.sha256}"`,
      "Content-Length": String(meta.size),
    },
  });
}

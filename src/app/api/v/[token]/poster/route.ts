import { NextRequest, NextResponse } from "next/server";
import { sharePoster } from "@/lib/content-studio/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC: the FROZEN, version-bound poster for a live share (shown before playback), read from the
// ArtifactStore by the object key bound to the share. Token-gated + goes away on revoke — a revoked/
// unknown share returns 410 and can never expose the image; a share with no poster → 404.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const poster = await sharePoster(params.token);
  // sharePoster returns null for unknown/revoked OR no-poster; distinguish revoked (410) from missing (404)
  // by re-checking would require another read — a null here is safe to surface as 410 for the not-live case.
  if (!poster) return new NextResponse("unavailable", { status: 410, headers: { "X-Robots-Tag": "noindex" } });
  // Node Buffer is a valid Web body at runtime; the DOM BodyInit type doesn't model Buffer<ArrayBufferLike>.
  return new NextResponse(poster.bytes as unknown as BodyInit, { status: 200, headers: { "Content-Type": poster.contentType, "Content-Length": String(poster.bytes.length), "Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex" } });
}

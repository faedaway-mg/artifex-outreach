import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";
import { resolvePersonalizedVideoForServe } from "@/lib/quick-fix/personalized-video-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Node Buffer is a valid Web body at runtime; the DOM BodyInit type doesn't model Buffer.
const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// CUSTOMER-FACING PERSONALIZED VIDEO (video/mp4). Streams the DURABLE ArtifactStore
// bytes for an offer's personalized diagnostic video. Access mirrors the offer page:
//   • operator session may preview any offer, OR
//   • a customer via the offer's own unrevoked share token on an APPROVED offer.
// Only the CURRENT coherent render is served — a stale/superseded render 409s. No raw
// storage URL, filesystem path, or secret is ever exposed. Supports HTTP Range.
export async function GET(req: NextRequest, { params }: { params: { offerId: string } }) {
  const res = await resolvePersonalizedVideoForServe(params.offerId, { operator: isAuthenticated() });
  if (!res.ok || !res.record?.mp4Key) {
    return new NextResponse("Not found", { status: res.httpStatus === 200 ? 404 : res.httpStatus });
  }

  const key = res.record.mp4Key;
  const meta = await getArtifactStore().getMeta(key);
  if (!meta) return new NextResponse("Not found", { status: 404 });

  const size = meta.size;
  const base = {
    "Content-Type": meta.contentType || "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    ETag: `"${meta.sha256}"`,
  };
  const range = req.headers.get("range");

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) {
      return new NextResponse("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const chunk = await getArtifactStore().readRange(key, start, end);
    if (!chunk) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(bin(chunk), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const full = await getArtifactStore().readFull(key);
  if (!full) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(bin(full), { status: 200, headers: { ...base, "Content-Length": String(size) } });
}

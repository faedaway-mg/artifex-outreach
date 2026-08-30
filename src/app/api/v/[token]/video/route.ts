import { NextRequest, NextResponse } from "next/server";
import { getShare, isLive, readShareVideoRange } from "@/lib/content-studio/share";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A Node Buffer is a valid Web response body at runtime; the DOM BodyInit type just doesn't model
// Buffer<ArrayBufferLike>. Narrow it here in one place.
const body = (b: Buffer): BodyInit => b as unknown as BodyInit;

// PUBLIC (no session — a prospect has none): serve the FROZEN approved mp4 for a live share token, with
// HTTP Range support (seeking). The bytes live in the ArtifactStore and are reached ONLY by the object
// key bound to the share record — never a filesystem path. Revoked or unknown tokens → 410 (the object is
// never exposed); a missing object → 404. The token is the capability; there is no enumerable id.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const share = await getShare(params.token);
  if (!isLive(share)) return new NextResponse("This video is no longer available.", { status: 410 });
  const meta = await getArtifactStore().getMeta(share.videoKey);
  if (!meta) return new NextResponse("unavailable", { status: 404 });
  const size = meta.size;
  const headersBase = { "Content-Type": meta.contentType || "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", ETag: `"${meta.sha256}"` };

  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) return new NextResponse("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const chunk = await readShareVideoRange(share.videoKey, start, end);
    if (!chunk) return new NextResponse("unavailable", { status: 404 });
    return new NextResponse(body(chunk), { status: 206, headers: { ...headersBase, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const full = await readShareVideoRange(share.videoKey, 0, size - 1);
  if (!full) return new NextResponse("unavailable", { status: 404 });
  return new NextResponse(body(full), { status: 200, headers: { ...headersBase, "Content-Length": String(size) } });
}

import { NextRequest, NextResponse } from "next/server";
import { statSync, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { getShare, isLive, shareMediaPath, openMediaStream } from "@/lib/content-studio/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PUBLIC (no session — a prospect has none): stream the FROZEN approved mp4 for a live share token, with
// HTTP Range support (seeking). The bucket/file stays private; access is resolved ONLY through the share
// record. Revoked or unknown tokens → unavailable. The token is the capability; there is no enumerable id.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const share = await getShare(params.token);
  if (!share || !isLive(share)) return new NextResponse("This video is no longer available.", { status: 410 });
  const file = shareMediaPath(params.token);
  if (!existsSync(file)) return new NextResponse("unavailable", { status: 404 });
  const size = statSync(file).size;
  const range = req.headers.get("range");
  const headersBase = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end) return new NextResponse("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(openMediaStream(params.token, start, end)) as unknown as ReadableStream;
    return new NextResponse(stream, { status: 206, headers: { ...headersBase, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(openMediaStream(params.token, 0, size - 1)) as unknown as ReadableStream;
  return new NextResponse(stream, { status: 200, headers: { ...headersBase, "Content-Length": String(size) } });
}

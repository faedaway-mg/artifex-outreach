import { NextRequest, NextResponse } from "next/server";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";
import { getMattTrustVideo } from "@/lib/voice/matt-trust-store";
import type { TrustVideoScope } from "@/lib/quick-fix/trust-videos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// MATT TRUST VIDEO (video/mp4). Evergreen trust content, shared across all Matt journeys
// of a scope (same publicness as the legacy /trust-videos/*.mp4 assets). Streams the
// DURABLE ArtifactStore bytes for the scope's Matt trust video. No secret / raw storage
// URL / filesystem path is exposed. Supports HTTP Range. 404 until the scope's Matt trust
// video has been built (a Matt journey missing it is blocked at approval, never here).
export async function GET(req: NextRequest, { params }: { params: { scope: string } }) {
  const rec = await getMattTrustVideo(params.scope as TrustVideoScope);
  if (!rec || !rec.mp4Key) return new NextResponse("Not found", { status: 404 });

  const meta = await getArtifactStore().getMeta(rec.mp4Key);
  if (!meta) return new NextResponse("Not found", { status: 404 });

  const size = meta.size;
  const base = {
    "Content-Type": meta.contentType || "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=300",
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
    const chunk = await getArtifactStore().readRange(rec.mp4Key, start, end);
    if (!chunk) return new NextResponse("Not found", { status: 404 });
    return new NextResponse(bin(chunk), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const full = await getArtifactStore().readFull(rec.mp4Key);
  if (!full) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(bin(full), { status: 200, headers: { ...base, "Content-Length": String(size) } });
}

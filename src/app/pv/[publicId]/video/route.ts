import { NextRequest, NextResponse } from "next/server";
import { resolvePublicShare } from "@/lib/outreach/prospect-package-store";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = (b: Buffer): BodyInit => b as unknown as BodyInit;

// PUBLIC (no session — a prospect has none): stream the FROZEN sales-package mp4 for a valid, signed,
// non-revoked /pv link, with HTTP Range support. The bytes live in the ArtifactStore, reached ONLY by the
// object key bound to the frozen package — never a filesystem path, never Content Studio. Any signature /
// revocation / version / state failure returns without exposing the object. No recipient PII is involved.
export async function GET(req: NextRequest, { params }: { params: { publicId: string } }) {
  const q = req.nextUrl.searchParams;
  const res = await resolvePublicShare({
    publicId: params.publicId, packageId: String(q.get("p") ?? ""),
    packageVersion: Number(q.get("v") ?? 0), keyVersion: Number(q.get("k") ?? 0), sig: String(q.get("s") ?? ""),
  });
  if (!res.ok || !res.videoKey) return new NextResponse("This video is not available.", { status: res.status });

  const store = getArtifactStore();
  const meta = await store.getMeta(res.videoKey);
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
    const chunk = await store.readRange(res.videoKey, start, end);
    if (!chunk) return new NextResponse("unavailable", { status: 404 });
    return new NextResponse(body(chunk), { status: 206, headers: { ...headersBase, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const full = await store.readFull(res.videoKey);
  if (!full) return new NextResponse("unavailable", { status: 404 });
  return new NextResponse(body(full), { status: 200, headers: { ...headersBase, "Content-Length": String(size) } });
}

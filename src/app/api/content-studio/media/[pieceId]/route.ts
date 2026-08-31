import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listJobs } from "@/lib/content-studio/store";
import { latestReadyJob } from "@/lib/content-studio/job";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Node Buffer is a valid Web body at runtime; the DOM BodyInit type doesn't model Buffer<ArrayBufferLike>.
const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// GET → INLINE playback of the piece's current recommended posting file (latest READY render), served
// from the ArtifactStore by its durable output key with HTTP Range (the in-app player seeks). AUTH-GATED
// (Content Studio is operator-only). This is the production-safe source for `recommendedRel` — the web
// service never reads the worker's filesystem. A render with no durable key yet (dev/master) → 404, and
// the app falls back to the committed /content asset.
export async function GET(req: NextRequest, { params }: { params: { pieceId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ready = latestReadyJob(await listJobs(), params.pieceId);
  if (!ready || !ready.outputKey) return NextResponse.json({ error: "no media" }, { status: 404 });
  const store = getArtifactStore();
  const meta = await store.getMeta(ready.outputKey);
  if (!meta) return NextResponse.json({ error: "no media" }, { status: 404 });
  const size = meta.size;
  const base = { "Content-Type": meta.contentType || "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", ETag: `"${meta.sha256}"` };

  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) return new NextResponse("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const chunk = await store.readRange(ready.outputKey, start, end);
    if (!chunk) return NextResponse.json({ error: "no media" }, { status: 404 });
    return new NextResponse(bin(chunk), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const full = await store.readFull(ready.outputKey);
  if (!full) return NextResponse.json({ error: "no media" }, { status: 404 });
  return new NextResponse(bin(full), { status: 200, headers: { ...base, "Content-Length": String(size) } });
}

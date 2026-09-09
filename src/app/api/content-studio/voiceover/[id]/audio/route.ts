import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getVoiceover } from "@/lib/voice/store";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Node Buffer is a valid Web body at runtime; the DOM BodyInit type doesn't model Buffer<ArrayBufferLike>.
const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// GET → stream a generated voiceover's audio for in-app playback. AUTH-GATED: the generated VO is PRIVATE
// and served ONLY from the ArtifactStore by the record's persisted assetKey (never a public asset path).
// 404 unless the record exists AND is READY with a persisted asset. Supports HTTP Range so the player can
// scrub. Mirrors the content-studio upload audio route.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rec = await getVoiceover(params.id);
  if (!rec || rec.status !== "VOICEOVER_READY" || !rec.assetKey) {
    return NextResponse.json({ error: "no audio" }, { status: 404 });
  }

  const meta = await getArtifactStore().getMeta(rec.assetKey);
  if (!meta) return NextResponse.json({ error: "no audio" }, { status: 404 });

  const size = meta.size;
  const base = {
    "Content-Type": meta.contentType || "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
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
    const chunk = await getArtifactStore().readRange(rec.assetKey, start, end);
    if (!chunk) return NextResponse.json({ error: "no audio" }, { status: 404 });
    return new NextResponse(bin(chunk), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const full = await getArtifactStore().readFull(rec.assetKey);
  if (!full) return NextResponse.json({ error: "no audio" }, { status: 404 });
  return new NextResponse(bin(full), { status: 200, headers: { ...base, "Content-Length": String(size) } });
}

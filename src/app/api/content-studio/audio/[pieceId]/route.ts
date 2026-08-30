import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync, readFileSync } from "node:fs";
import { isAuthenticated } from "@/lib/auth";
import { latestUpload } from "@/lib/content-studio/store";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Node Buffer is a valid Web body at runtime; the DOM BodyInit type doesn't model Buffer<ArrayBufferLike>.
const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

function audioType(name: string): string {
  const n = name.toLowerCase();
  return n.endsWith(".wav") ? "audio/wav" : n.endsWith(".m4a") || n.endsWith(".aac") ? "audio/mp4" : "audio/mpeg";
}

// GET → stream the most recent uploaded voiceover for a piece, for in-app playback. AUTH-GATED: the raw
// VO is PRIVATE — served ONLY from the ArtifactStore by the upload's persisted object key (never a public
// asset path). Supports HTTP Range so the player can scrub. Falls back to the legacy local file only in
// dev, when an older upload has no persisted key yet.
export async function GET(req: NextRequest, { params }: { params: { pieceId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const up = await latestUpload(params.pieceId);
  if (!up) return NextResponse.json({ error: "no audio" }, { status: 404 });
  const type = audioType(up.name);
  const range = req.headers.get("range");

  if (up.objectKey) {
    const meta = await getArtifactStore().getMeta(up.objectKey);
    if (!meta) {
      // No object AND no legacy file → genuinely gone.
      if (!up.file || !existsSync(up.file)) return NextResponse.json({ error: "no audio" }, { status: 404 });
    } else {
      const size = meta.size;
      const base = { "Content-Type": meta.contentType || type, "Accept-Ranges": "bytes", "Cache-Control": "no-store", ETag: `"${meta.sha256}"` };
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
        if (Number.isNaN(start) || start < 0) start = 0;
        if (Number.isNaN(end) || end >= size) end = size - 1;
        if (start > end || start >= size) return new NextResponse("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        const chunk = await getArtifactStore().readRange(up.objectKey, start, end);
        if (!chunk) return NextResponse.json({ error: "no audio" }, { status: 404 });
        return new NextResponse(bin(chunk), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
      }
      const full = await getArtifactStore().readFull(up.objectKey);
      if (!full) return NextResponse.json({ error: "no audio" }, { status: 404 });
      return new NextResponse(bin(full), { status: 200, headers: { ...base, "Content-Length": String(size) } });
    }
  }

  // LEGACY dev fallback — an old upload with no persisted key.
  if (!up.file || !existsSync(up.file)) return NextResponse.json({ error: "no audio" }, { status: 404 });
  const legacy = readFileSync(up.file);
  return new NextResponse(bin(legacy), { status: 200, headers: { "Content-Type": type, "Content-Length": String(statSync(up.file).size), "Cache-Control": "no-store" } });
}

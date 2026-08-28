import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { isAuthenticated } from "@/lib/auth";
import { latestUpload } from "@/lib/content-studio/store";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → stream the most recent uploaded voiceover for a piece, for in-app playback. AUTH-GATED: the raw
// VO lives under .data (private) and is never exposed via a public asset path.
export async function GET(_req: NextRequest, { params }: { params: { pieceId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const up = await latestUpload(params.pieceId);
  if (!up || !existsSync(up.file)) return NextResponse.json({ error: "no audio" }, { status: 404 });
  const size = statSync(up.file).size;
  const ext = up.name.toLowerCase();
  const type = ext.endsWith(".wav") ? "audio/wav" : ext.endsWith(".m4a") || ext.endsWith(".aac") ? "audio/mp4" : "audio/mpeg";
  const stream = Readable.toWeb(createReadStream(up.file)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: { "Content-Type": type, "Content-Length": String(size), "Cache-Control": "no-store" },
  });
}

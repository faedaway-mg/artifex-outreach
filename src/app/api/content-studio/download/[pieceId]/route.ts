import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listJobs } from "@/lib/content-studio/store";
import { latestReadyJob } from "@/lib/content-studio/job";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → operator download of the piece's current recommended posting file (the latest READY render),
// served from the ArtifactStore by its durable output key with a Content-Disposition attachment. AUTH-
// GATED. A piece whose latest ready render has no durable key yet (legacy/dev) → 404 (use the in-app
// recommended file); nothing here reads a filesystem path.
export async function GET(_req: NextRequest, { params }: { params: { pieceId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ready = latestReadyJob(await listJobs(), params.pieceId);
  if (!ready || !ready.outputKey) return NextResponse.json({ error: "no downloadable render" }, { status: 404 });
  const store = getArtifactStore();
  const meta = await store.getMeta(ready.outputKey);
  if (!meta) return NextResponse.json({ error: "no downloadable render" }, { status: 404 });
  const bytes = await store.readFull(ready.outputKey);
  if (!bytes) return NextResponse.json({ error: "no downloadable render" }, { status: 404 });
  const filename = `field-note-${params.pieceId}.mp4`;
  // Node Buffer is a valid Web body at runtime; the DOM BodyInit type doesn't model Buffer<ArrayBufferLike>.
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": meta.contentType || "video/mp4",
      "Content-Length": String(meta.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      ETag: `"${meta.sha256}"`,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { listJobs } from "@/lib/content-studio/store";
import { latestReadyJob } from "@/lib/content-studio/job";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// A clean fallback tile (NEVER a browser broken-image icon) when a piece has no rendered poster yet.
function fallback(): NextResponse {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960" viewBox="0 0 540 960">
  <rect width="540" height="960" fill="#0e1524"/>
  <rect x="20" y="20" width="500" height="920" rx="16" fill="none" stroke="#23324c" stroke-width="2"/>
  <text x="270" y="490" fill="#7f8ba3" font-family="Inter,system-ui,sans-serif" font-size="24" text-anchor="middle">No render yet</text>
</svg>`;
  return new NextResponse(svg, { status: 200, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" } });
}

// GET → the frame-zero poster of the piece's latest READY render, served from the ArtifactStore by its
// durable posterKey (authenticated, operator-only). ETag = poster SHA so a re-render invalidates caches.
// This is the honest source for a client-video cover thumbnail (the old /content/thumbnails/*.png path
// 404'd for client videos → broken image). A piece with no render yet gets a clean fallback tile, never
// a broken-image icon.
export async function GET(req: NextRequest, { params }: { params: { pieceId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ready = latestReadyJob(await listJobs(), params.pieceId);
  if (!ready || !ready.posterKey) return fallback();
  const store = getArtifactStore();
  const meta = await store.getMeta(ready.posterKey);
  if (!meta) return fallback();
  const full = await store.readFull(ready.posterKey);
  if (!full) return fallback();
  const etag = `"${meta.sha256}"`;
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag } });
  return new NextResponse(bin(full), {
    status: 200,
    headers: {
      "Content-Type": meta.contentType || "image/png",
      "Content-Length": String(meta.size),
      "Cache-Control": "private, max-age=60, must-revalidate",
      ETag: etag,
      "X-Robots-Tag": "noindex",
    },
  });
}

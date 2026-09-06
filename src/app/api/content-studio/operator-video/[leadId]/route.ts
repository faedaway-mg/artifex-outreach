import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";
import { resolveCurrentVideo } from "@/lib/outreach/prospect-package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// CANONICAL OPERATOR VIDEO (mandate 23). Authenticated, internal preview + download of the operator's
// CURRENT video for a lead — resolved through the ONE canonical resolveCurrentVideo (committed-package
// binding wins over latest render). It streams the internal artifact BY KEY, so it never depends on an
// expiring recipient share and can be previewed before sending / before narration where a base exists.
// `?download=1` returns the same canonical bytes as an attachment with a real filename. Honest 404 when
// no canonical artifact exists — the caller disables the control with the resolver's reason.
export async function GET(req: NextRequest, { params }: { params: { leadId: string } }) {
  if (!isAuthenticated()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cur = await resolveCurrentVideo(params.leadId);
  if (!cur.available || !cur.artifactKey) return NextResponse.json({ error: cur.reason ?? "no media" }, { status: 404 });
  const store = getArtifactStore();
  const meta = await store.getMeta(cur.artifactKey);
  if (!meta) return NextResponse.json({ error: "no media" }, { status: 404 });
  const size = meta.size;
  const download = req.nextUrl.searchParams.get("download") === "1";
  const filename = `prospect-video-${params.leadId}-${cur.revisionId ?? "current"}.mp4`;
  const base: Record<string, string> = {
    "Content-Type": meta.contentType || "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    ETag: `"${meta.sha256}"`,
    // Expose the canonical identity so clients/tests can verify equality across surfaces without downloading.
    "X-Artifact-Sha256": meta.sha256 ?? "",
    "X-Video-Source": cur.source,
    "X-Video-Revision": cur.revisionId ?? "",
  };
  if (download) base["Content-Disposition"] = `attachment; filename="${filename}"`;

  const range = req.headers.get("range");
  if (range && !download) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end || start >= size) return new NextResponse("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const chunk = await store.readRange(cur.artifactKey, start, end);
    if (!chunk) return NextResponse.json({ error: "no media" }, { status: 404 });
    return new NextResponse(bin(chunk), { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const full = await store.readFull(cur.artifactKey);
  if (!full) return NextResponse.json({ error: "no media" }, { status: 404 });
  return new NextResponse(bin(full), { status: 200, headers: { ...base, "Content-Length": String(size) } });
}

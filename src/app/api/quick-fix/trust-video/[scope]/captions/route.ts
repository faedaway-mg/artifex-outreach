import { NextRequest, NextResponse } from "next/server";
import { getArtifactStore } from "@/lib/content-studio/storage-factory";
import { getMattTrustVideo } from "@/lib/voice/matt-trust-store";
import type { TrustVideoScope } from "@/lib/quick-fix/trust-videos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bin = (b: Buffer): BodyInit => b as unknown as BodyInit;

// MATT TRUST VIDEO CAPTIONS (text/vtt). Served only when captions were verified verbatim.
export async function GET(_req: NextRequest, { params }: { params: { scope: string } }) {
  const rec = await getMattTrustVideo(params.scope as TrustVideoScope);
  if (!rec || !rec.captionsKey || !rec.captionsVerified) return new NextResponse("Not found", { status: 404 });
  const meta = await getArtifactStore().getMeta(rec.captionsKey);
  if (!meta) return new NextResponse("Not found", { status: 404 });
  const full = await getArtifactStore().readFull(rec.captionsKey);
  if (!full) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(bin(full), {
    status: 200,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ETag: `"${meta.sha256}"`,
      "Content-Length": String(meta.size),
    },
  });
}

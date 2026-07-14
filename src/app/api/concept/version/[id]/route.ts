import { NextRequest } from "next/server";
import { getVersion } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Authenticated internal review of a rendered concept version (protected by
// middleware — not public). Same sanitized HTML the share route serves.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const version = await getVersion(params.id);
  if (!version) return new Response("Not found", { status: 404 });
  return new Response(version.renderedHtml, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; script-src 'none'; frame-ancestors 'self'; base-uri 'none'",
      "Cache-Control": "no-store",
    },
  });
}

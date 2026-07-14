import { NextRequest } from "next/server";
import { getShareByHash, updateShare, getPreview, getVersion, updatePreview } from "@/lib/repo";
import { hashToken } from "@/lib/concept/share";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public concept preview page. Resolves a hashed share token, enforces
// revocation/expiry, records a view, and returns the sanitized preview HTML with
// hardened headers. Exposes no private lead data, IDs, or Outreach navigation.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`share:${ip}`, 60, 60_000).allowed) return notFound();

  const token = params.token ?? "";
  if (token.length < 20 || token.length > 128) return notFound();

  const share = await getShareByHash(hashToken(token));
  if (!share) return notFound();
  if (share.revokedAt) return notFound();
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) return notFound();

  const version = await getVersion(share.versionId);
  if (!version) return notFound();

  // Record the view (never triggers outreach).
  await updateShare(share.id, { viewCount: share.viewCount + 1, lastViewedAt: new Date().toISOString() });
  const preview = await getPreview(share.previewId);
  if (preview && preview.status === "Shared") await updatePreview(preview.id, { status: "Viewed" });

  return new Response(version.renderedHtml, { status: 200, headers: safeHeaders() });
}

function safeHeaders(): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src 'none'; script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  };
}

function notFound(): Response {
  return new Response(
    "<!doctype html><html><head><meta name='robots' content='noindex,nofollow'><title>Not available</title></head><body style='font-family:system-ui;background:#0b0f16;color:#aeb8cb;display:grid;place-items:center;height:100vh;margin:0'><p>This preview link is not available.</p></body></html>",
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" } },
  );
}

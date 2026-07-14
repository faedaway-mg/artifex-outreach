import type { NextRequest } from "next/server";

/**
 * The correct external origin behind a proxy (Railway). Route handlers see the
 * internal bind address on req.url, so we prefer the forwarded headers.
 */
export function externalOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  return `${proto}://${host}`;
}

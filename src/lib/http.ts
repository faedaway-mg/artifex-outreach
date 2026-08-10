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

// ── Content-Disposition ──────────────────────────────────────────────────────
// A Content-Disposition filename must be a Latin1 (ByteString) header value, so a filename
// with any character > 255 (e.g. an em dash "—", U+2014) makes `new Response({ headers })`
// throw and the route returns a blank 500. Build a safe header per RFC 5987: an ASCII
// fallback for old clients PLUS a UTF-8 `filename*` that modern browsers honor.

/** ASCII-safe rendition of a filename for the plain `filename=` parameter. */
function asciiFilename(name: string): string {
  return (name
    .replace(/[‐-―−]/g, "-") // hyphens/dashes (incl. em dash) → "-"
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"') // smart quotes
    .replace(/[^\x20-\x7E]/g, "") // drop any remaining non-ASCII
    .replace(/["\\]/g, "") // no quotes/backslashes inside the quoted string
    .replace(/\s{2,}/g, " ")
    .trim()) || "download";
}

/** A safe `Content-Disposition` value: `inline|attachment; filename="ascii"; filename*=UTF-8''<pct>`. */
export function contentDisposition(filename: string, mode: "inline" | "attachment" = "inline"): string {
  const ascii = asciiFilename(filename);
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

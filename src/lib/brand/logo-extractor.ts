// ─────────────────────────────────────────────────────────────────────────────
// Business logo / brand discovery.
//
// This REUSES the proven merchant-logo extraction algorithm from AshMap
// (~/AshMap/artifacts/api-server/src/routes/merchant.ts → discoverLogoCandidates):
// the same first-party evidence order and the same confidence/provenance model. It is
// ported here as a self-contained, dependency-free module (native fetch + regex only)
// so Acquisition OS gains the capability WITHOUT coupling to AshMap's runtime, DB, or
// S3. The parser is split out (pure) so it is unit-testable without the network.
//
// It never fabricates a logo: it only reports candidates it actually found on the
// business's own site, each tagged with where it came from and how much to trust it.
// The eventual shared home for this is a cross-repo package — tracked follow-up.
// ─────────────────────────────────────────────────────────────────────────────

export type LogoSourceType =
  | "apple-touch-icon"
  | "logo-img"
  | "og:image"
  | "twitter:image"
  | "favicon-svg"
  | "favicon"
  | "header-img";

export interface LogoCandidate {
  url: string;
  sourceType: LogoSourceType;
  /** 0..1 — higher is more trustworthy as the real brand mark. */
  confidence: number;
  reason: string;
}

const LOGO_ATTR = /(?:class|id|alt|src|data-src)=["'][^"']*logo[^"']*["']/i;

/**
 * Parse candidate logos out of a page's HTML. Pure — `baseUrl` resolves relative asset
 * paths. Ordered by the same source priority AshMap uses; deduped by URL; top 5.
 */
export function extractLogoCandidates(html: string, baseUrl: string): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const seen = new Set<string>();
  const resolveUrl = (href: string): string | null => {
    if (!href || href.startsWith("data:") || href.startsWith("javascript:")) return null;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  };
  const add = (c: LogoCandidate | { url: string | null } & Omit<LogoCandidate, "url">) => {
    if (!c.url || seen.has(c.url)) return;
    seen.add(c.url);
    out.push(c as LogoCandidate);
  };

  // 1. Apple touch icon — typically the brand mark (both attribute orders).
  for (const m of html.matchAll(/<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["'][^>]*>/gi)) {
    add({ url: resolveUrl(m[1] ?? ""), sourceType: "apple-touch-icon", confidence: 0.9, reason: "Apple touch icon — typically the brand mark" });
  }
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*>/gi)) {
    add({ url: resolveUrl(m[1] ?? ""), sourceType: "apple-touch-icon", confidence: 0.9, reason: "Apple touch icon — typically the brand mark" });
  }

  // 2. <img> with "logo" in its attributes or src — a strong signal.
  for (const m of html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    const src = m[1];
    if (!src || src.startsWith("data:")) continue;
    if (!(LOGO_ATTR.test(m[0]) || /logo/i.test(src))) continue;
    add({ url: resolveUrl(src), sourceType: "logo-img", confidence: 0.87, reason: "Image with 'logo' in attributes — strong signal" });
  }

  // 3. Open Graph image (both attribute orders).
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og?.[1]) add({ url: resolveUrl(og[1]), sourceType: "og:image", confidence: 0.75, reason: "Open Graph image" });

  // 4. Twitter card image.
  const tw = html.match(/<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image(?::src)?["']/i);
  if (tw?.[1]) add({ url: resolveUrl(tw[1]), sourceType: "twitter:image", confidence: 0.7, reason: "Twitter card image" });

  // 5. Favicon — SVG (vector brand) or a large raster (192/256/512). Both attribute orders.
  const faviconLink = (href: string) => {
    if (!href) return;
    const isSvg = /\.svg(\?|$)/i.test(href);
    const isLarge = /\b(192|256|512)\b/.test(href);
    if (!isSvg && !isLarge) return;
    add({
      url: resolveUrl(href),
      sourceType: isSvg ? "favicon-svg" : "favicon",
      confidence: isSvg ? 0.78 : 0.65,
      reason: isSvg ? "SVG favicon — vector brand mark" : "Large favicon",
    });
  };
  for (const m of html.matchAll(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["'][^>]*>/gi)) faviconLink(m[1] ?? "");
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["'][^>]*>/gi)) faviconLink(m[1] ?? "");

  // 6. Header / nav images — weak, last-resort.
  const headerBlocks = [...html.matchAll(/<(?:header|nav)[^>]*>[\s\S]*?<\/(?:header|nav)>/gi)].map((m) => m[0]).join("\n");
  for (const m of headerBlocks.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)) {
    if (!m[1] || m[1].startsWith("data:")) continue;
    add({ url: resolveUrl(m[1]), sourceType: "header-img", confidence: 0.55, reason: "Header/nav image" });
  }

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

/** The best candidate at or above `minConfidence`, or null. A wrong logo is worse than none. */
export function bestLogo(candidates: LogoCandidate[], minConfidence = 0.75): LogoCandidate | null {
  return candidates.find((c) => c.confidence >= minConfidence) ?? null;
}

/**
 * Fetch a business website and discover its logo candidates. Network-guarded (12s
 * timeout, capped read). Returns [] on any failure — never throws, never fabricates.
 */
export async function discoverLogoCandidates(websiteUrl: string): Promise<LogoCandidate[]> {
  let url = (websiteUrl ?? "").trim();
  if (!url) return [];
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ArtifexLabs/1.0; +https://artifexlabs.tech)", Accept: "text/html,application/xhtml+xml,*/*" },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = (await res.text()).slice(0, 150_000);
    return extractLogoCandidates(html, res.url || url);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Respectful intelligence crawler.
//
// Professional, not aggressive: robots.txt aware, same-origin only, conservative
// page cap, canonical URLs, duplicate detection, importance-prioritized traversal,
// content + metadata extraction. Uses the polite HttpClient. All parsing helpers
// are pure and unit-tested; the crawl loop is driven by an injectable client.
// ─────────────────────────────────────────────────────────────────────────────
import { HttpClient, parseRobots, robotsAllows, type RobotsRules } from "./http-client";

export interface CrawledPage {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  text: string;
  title: string;
  importance: number;
}

export interface CrawlResult {
  origin: string;
  pages: CrawledPage[];
  robotsRespected: boolean;
  notes: string[];
  stats: { fetched: number; skippedByRobots: number; duplicates: number };
}

export interface CrawlOptions {
  client: HttpClient;
  userAgent: string;
  maxPages: number;
}

export async function crawlSite(startUrl: string, opts: CrawlOptions): Promise<CrawlResult> {
  const notes: string[] = [];
  let origin: string;
  try {
    origin = new URL(startUrl).origin;
  } catch {
    return { origin: startUrl, pages: [], robotsRespected: false, notes: ["invalid start url"], stats: { fetched: 0, skippedByRobots: 0, duplicates: 0 } };
  }

  // 1) robots.txt
  let robots: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  const robotsRes = await opts.client.get(`${origin}/robots.txt`);
  if (robotsRes.ok && robotsRes.body) robots = parseRobots(robotsRes.body, opts.userAgent);
  else notes.push("robots.txt unavailable — defaulting to conservative allow");

  const stats = { fetched: 0, skippedByRobots: 0, duplicates: 0 };
  const visited = new Set<string>();
  const contentHashes = new Set<string>();
  const pages: CrawledPage[] = [];

  // 2) prioritized frontier (importance desc)
  const frontier: string[] = [canonicalizeUrl(startUrl)];
  while (frontier.length && pages.length < opts.maxPages) {
    frontier.sort((a, b) => pageImportanceScore(b) - pageImportanceScore(a));
    const url = frontier.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const path = pathOf(url);
    if (!robotsAllows(robots, path)) {
      stats.skippedByRobots++;
      continue;
    }

    const res = await opts.client.get(url);
    if (!res.ok || !/html/i.test(res.contentType || "html")) continue;
    stats.fetched++;

    const text = htmlToText(res.body);
    const hash = contentHash(text);
    if (contentHashes.has(hash)) {
      stats.duplicates++;
      continue;
    }
    contentHashes.add(hash);

    pages.push({ url, finalUrl: res.finalUrl, status: res.status, html: res.body, text, title: extractTitle(res.body), importance: pageImportanceScore(url) });

    // 3) enqueue same-origin links
    for (const link of extractLinks(res.body, url)) {
      const canon = canonicalizeUrl(link);
      if (canon.startsWith(origin) && !visited.has(canon) && !frontier.includes(canon)) frontier.push(canon);
    }
  }

  return { origin, pages, robotsRespected: true, notes, stats };
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    // strip tracking params
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) u.searchParams.delete(k);
    let s = u.toString();
    s = s.replace(/\/$/, ""); // trailing slash
    return s;
  } catch {
    return raw;
  }
}

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

/** Higher = crawl sooner. Homepage + commercial/contact pages beat blog/legal. */
export function pageImportanceScore(url: string): number {
  const p = pathOf(url).toLowerCase();
  if (p === "/" || p === "") return 100;
  const rules: Array<[RegExp, number]> = [
    [/book|schedul|appoint/, 92],
    [/contact/, 88],
    [/service|solutions|what-we|offerings/, 85],
    [/pricing|plans|quote/, 84],
    [/about|team|company/, 78],
    [/portal|account|login|client/, 74],
    [/faq|support|help/, 70],
    [/case|work|portfolio|result/, 66],
    [/product|shop|store/, 64],
    [/career|job/, 40],
    [/blog|news|article|post/, 35],
    [/privacy|terms|legal|policy|cookie/, 20],
  ];
  for (const [re, score] of rules) if (re.test(p)) return score;
  return 50;
}

export function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].trim()).slice(0, 200) : "";
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      out.add(new URL(href, baseUrl).toString());
    } catch {
      /* ignore malformed */
    }
  }
  return [...out];
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/** Stable, cheap content fingerprint for duplicate detection (not cryptographic). */
export function contentHash(text: string): string {
  let h = 2166136261;
  const norm = text.slice(0, 4000).toLowerCase();
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

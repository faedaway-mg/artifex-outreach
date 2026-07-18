// ─────────────────────────────────────────────────────────────────────────────
// Intelligence HTTP client — a POLITE, cached, resilient fetch layer for crawling.
//
// Built on the repo's SSRF-guarded safeFetch. Adds: in-memory caching (TTL +
// incremental refresh), retry with backoff on transient failures, per-host rate
// limiting (conservative delay), and robots.txt awareness. The fetcher is
// injectable so the crawler + providers are fully testable offline.
// ─────────────────────────────────────────────────────────────────────────────
import { safeFetch } from "../ssrf";

export interface FetchResponse {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  error?: string;
  /** True when served from cache (for performance metrics). */
  fromCache?: boolean;
}

export type Fetcher = (url: string) => Promise<FetchResponse>;

export const defaultFetcher: Fetcher = async (url) => {
  const r = await safeFetch(url);
  return { ok: r.ok, status: r.status, contentType: r.contentType, body: r.body, finalUrl: r.finalUrl, error: r.error };
};

interface CacheEntry {
  res: FetchResponse;
  expires: number;
}

export interface HttpClientOptions {
  fetcher?: Fetcher;
  cacheTtlMs?: number;
  minDelayMs?: number;
  maxRetries?: number;
  /** Injectable clock + sleeper keep tests instant and deterministic. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface FetchStats {
  requests: number;
  cacheHits: number;
  retries: number;
  failures: number;
}

export class HttpClient {
  private fetcher: Fetcher;
  private cacheTtlMs: number;
  private minDelayMs: number;
  private maxRetries: number;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private cache = new Map<string, CacheEntry>();
  private lastHostFetch = new Map<string, number>();
  public stats: FetchStats = { requests: 0, cacheHits: 0, retries: 0, failures: 0 };

  constructor(opts: HttpClientOptions = {}) {
    this.fetcher = opts.fetcher ?? defaultFetcher;
    this.cacheTtlMs = opts.cacheTtlMs ?? 24 * 60 * 60 * 1000;
    this.minDelayMs = opts.minDelayMs ?? 0;
    this.maxRetries = opts.maxRetries ?? 2;
    this.now = opts.now ?? (() => 0); // deterministic default; real client passes Date.now
    this.sleep = opts.sleep ?? (async () => {});
  }

  async get(url: string): Promise<FetchResponse> {
    const cached = this.cache.get(url);
    if (cached && cached.expires > this.now()) {
      this.stats.cacheHits++;
      return { ...cached.res, fromCache: true };
    }
    await this.throttle(url);

    let attempt = 0;
    let res: FetchResponse = { ok: false, status: 0, contentType: "", body: "", finalUrl: url, error: "not attempted" };
    while (attempt <= this.maxRetries) {
      this.stats.requests++;
      try {
        res = await this.fetcher(url);
      } catch (err) {
        res = { ok: false, status: 0, contentType: "", body: "", finalUrl: url, error: (err as Error).message };
      }
      if (res.ok || !isTransient(res.status)) break;
      attempt++;
      if (attempt <= this.maxRetries) {
        this.stats.retries++;
        await this.sleep(backoffMs(attempt));
      }
    }
    if (!res.ok) this.stats.failures++;
    else this.cache.set(url, { res, expires: this.now() + this.cacheTtlMs });
    return res;
  }

  private async throttle(url: string): Promise<void> {
    if (this.minDelayMs <= 0) return;
    const host = hostOf(url);
    const last = this.lastHostFetch.get(host) ?? 0;
    const wait = last + this.minDelayMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastHostFetch.set(host, this.now());
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function isTransient(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 599);
}
function backoffMs(attempt: number): number {
  return Math.min(8000, 250 * 2 ** attempt);
}
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ── robots.txt ───────────────────────────────────────────────────────────────
export interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

/** Parse robots.txt for the groups that apply to `ua` (falls back to `*`). */
export function parseRobots(text: string, ua: string): RobotsRules {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[]; crawlDelay: number | null }> = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.toLowerCase().trim();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      if (!lastWasAgent || !cur) {
        cur = { agents: [], disallow: [], allow: [], crawlDelay: null };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow") cur.disallow.push(val);
    else if (key === "allow") cur.allow.push(val);
    else if (key === "crawl-delay") cur.crawlDelay = Number(val) * 1000 || null;
  }
  const uaLc = ua.toLowerCase();
  const match =
    groups.find((g) => g.agents.some((a) => a !== "*" && uaLc.includes(a.split("/")[0]))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!match) return { disallow: [], allow: [], crawlDelayMs: null };
  return { disallow: match.disallow.filter(Boolean), allow: match.allow, crawlDelayMs: match.crawlDelay };
}

/** Longest-match allow/disallow per the robots spec. Empty Disallow = allow all. */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const matchLen = (patterns: string[]) =>
    patterns.reduce((best, p) => (p && path.startsWith(p) ? Math.max(best, p.length) : best), -1);
  const disallow = matchLen(rules.disallow);
  if (disallow < 0) return true;
  const allow = matchLen(rules.allow);
  return allow >= disallow; // allow wins ties
}

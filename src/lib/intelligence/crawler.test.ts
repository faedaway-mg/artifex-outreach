import { describe, it, expect } from "vitest";
import { canonicalizeUrl, pageImportanceScore, extractLinks, htmlToText, contentHash, extractTitle } from "./crawler";
import { HttpClient, parseRobots, robotsAllows, isTransient, type Fetcher, type FetchResponse } from "./http-client";

describe("Crawler pure helpers", () => {
  it("canonicalizes urls (drops hash, tracking params, trailing slash)", () => {
    expect(canonicalizeUrl("https://x.com/a/?utm_source=g&id=1#top")).toBe("https://x.com/a/?id=1");
    expect(canonicalizeUrl("https://x.com/a/")).toBe("https://x.com/a");
  });
  it("scores homepage + commercial pages above blog/legal", () => {
    expect(pageImportanceScore("https://x.com/")).toBeGreaterThan(pageImportanceScore("https://x.com/blog/post"));
    expect(pageImportanceScore("https://x.com/book-now")).toBeGreaterThan(pageImportanceScore("https://x.com/privacy"));
  });
  it("extracts same-doc links and ignores mailto/tel", () => {
    const links = extractLinks('<a href="/services">S</a><a href="mailto:x@y.com">M</a><a href="https://x.com/contact">C</a>', "https://x.com");
    expect(links).toContain("https://x.com/services");
    expect(links).toContain("https://x.com/contact");
    expect(links.some((l) => l.startsWith("mailto"))).toBe(false);
  });
  it("strips tags to text and hashes content stably", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("xyz"));
  });
  it("extracts a title", () => {
    expect(extractTitle("<title>Taylor Dental — Pasadena</title>")).toContain("Taylor Dental");
  });
});

describe("robots.txt", () => {
  const txt = `User-agent: *\nDisallow: /admin\nDisallow: /cart\nAllow: /admin/public\nCrawl-delay: 2`;
  it("parses rules for the wildcard agent", () => {
    const r = parseRobots(txt, "ArtifexIntelligenceBot/1.0");
    expect(r.disallow).toContain("/admin");
    expect(r.crawlDelayMs).toBe(2000);
  });
  it("respects disallow with allow override (longest match)", () => {
    const r = parseRobots(txt, "bot");
    expect(robotsAllows(r, "/admin")).toBe(false);
    expect(robotsAllows(r, "/admin/public")).toBe(true);
    expect(robotsAllows(r, "/services")).toBe(true);
  });
});

describe("HttpClient — cache, retry, failure handling", () => {
  const okRes = (url: string): FetchResponse => ({ ok: true, status: 200, contentType: "text/html", body: "<html>ok</html>", finalUrl: url });

  it("serves from cache on the second request", async () => {
    let calls = 0;
    const fetcher: Fetcher = async (url) => {
      calls++;
      return okRes(url);
    };
    const c = new HttpClient({ fetcher, now: () => 1000, cacheTtlMs: 10_000 });
    await c.get("https://x.com");
    const second = await c.get("https://x.com");
    expect(calls).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(c.stats.cacheHits).toBe(1);
  });

  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const fetcher: Fetcher = async (url) => {
      calls++;
      return calls < 3 ? { ok: false, status: 503, contentType: "", body: "", finalUrl: url } : okRes(url);
    };
    const c = new HttpClient({ fetcher, maxRetries: 3, now: () => 0 });
    const res = await c.get("https://x.com");
    expect(res.ok).toBe(true);
    expect(c.stats.retries).toBeGreaterThanOrEqual(2);
  });

  it("gives up gracefully on persistent failure (no throw)", async () => {
    const fetcher: Fetcher = async (url) => ({ ok: false, status: 500, contentType: "", body: "", finalUrl: url });
    const c = new HttpClient({ fetcher, maxRetries: 1, now: () => 0 });
    const res = await c.get("https://x.com");
    expect(res.ok).toBe(false);
    expect(c.stats.failures).toBe(1);
  });

  it("does not retry non-transient (404)", async () => {
    let calls = 0;
    const fetcher: Fetcher = async (url) => {
      calls++;
      return { ok: false, status: 404, contentType: "", body: "", finalUrl: url };
    };
    const c = new HttpClient({ fetcher, maxRetries: 3, now: () => 0 });
    await c.get("https://x.com");
    expect(calls).toBe(1);
    expect(isTransient(404)).toBe(false);
  });
});

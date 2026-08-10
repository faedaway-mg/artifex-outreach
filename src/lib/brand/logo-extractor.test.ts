import { describe, it, expect } from "vitest";
import { extractLogoCandidates, bestLogo } from "./logo-extractor";

const BASE = "https://villabrasil.example";

describe("logo extractor — reused AshMap algorithm, ported pure", () => {
  it("prefers the apple-touch-icon as the highest-confidence brand mark", () => {
    const html = `<head>
      <link rel="apple-touch-icon" href="/apple-touch-icon.png">
      <link rel="icon" href="/favicon.svg">
      <meta property="og:image" content="https://cdn.example/og.jpg">
    </head>`;
    const cands = extractLogoCandidates(html, BASE);
    expect(cands[0]).toMatchObject({ sourceType: "apple-touch-icon", confidence: 0.9 });
    expect(cands[0].url).toBe("https://villabrasil.example/apple-touch-icon.png"); // relative resolved
  });

  it("picks up an <img> with 'logo' in its attributes as a strong signal", () => {
    const html = `<header><img src="/assets/site-logo.png" alt="Villa Brasil logo"></header>`;
    const cands = extractLogoCandidates(html, BASE);
    expect(cands.some((c) => c.sourceType === "logo-img" && c.url.endsWith("/assets/site-logo.png"))).toBe(true);
  });

  it("records provenance + confidence for every candidate and sorts by confidence", () => {
    const html = `
      <link rel="icon" href="/favicon.svg">
      <meta name="twitter:image" content="https://cdn.example/tw.png">
      <meta property="og:image" content="https://cdn.example/og.png">`;
    const cands = extractLogoCandidates(html, BASE);
    const conf = cands.map((c) => c.confidence);
    expect(conf).toEqual([...conf].sort((a, b) => b - a)); // descending
    for (const c of cands) { expect(c.reason).toBeTruthy(); expect(c.sourceType).toBeTruthy(); }
  });

  it("ignores data: URIs and never returns more than five", () => {
    const imgs = Array.from({ length: 10 }, (_, i) => `<img src="/logo-${i}.png" class="logo">`).join("");
    const html = `<img src="data:image/png;base64,AAAA" class="logo">${imgs}`;
    const cands = extractLogoCandidates(html, BASE);
    expect(cands.length).toBeLessThanOrEqual(5);
    expect(cands.every((c) => !c.url.startsWith("data:"))).toBe(true);
  });

  it("returns nothing when there is no trustworthy brand asset (no fabrication)", () => {
    expect(extractLogoCandidates("<p>hello</p>", BASE)).toEqual([]);
    expect(bestLogo([])).toBeNull();
  });

  it("bestLogo withholds a low-confidence-only result (a wrong logo is worse than none)", () => {
    const html = `<header><img src="/random-hero.jpg"></header>`; // only a weak header image
    const cands = extractLogoCandidates(html, BASE);
    expect(cands[0]?.sourceType).toBe("header-img");
    expect(bestLogo(cands, 0.75)).toBeNull(); // below threshold → withheld
  });

  it("business A's HTML never yields business B's asset (base-scoped resolution)", () => {
    const a = extractLogoCandidates(`<link rel="apple-touch-icon" href="/logo.png">`, "https://a-business.example");
    const b = extractLogoCandidates(`<link rel="apple-touch-icon" href="/logo.png">`, "https://b-business.example");
    expect(a[0].url).toBe("https://a-business.example/logo.png");
    expect(b[0].url).toBe("https://b-business.example/logo.png");
    expect(a[0].url).not.toBe(b[0].url);
  });
});

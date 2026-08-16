// Surface package (M1.1 completion) — the analyzed HTML is sanitized (no active scripts/trackers/forms)
// and persisted for the renderer; the renderer never re-crawls. Pure.
import { describe, it, expect } from "vitest";
import { sanitizeSurfaceHtml, buildSurfacePackage, primarySurfaceBody } from "./surface";

describe("sanitizeSurfaceHtml — safe, renderable snapshot", () => {
  it("strips scripts, iframes, inline handlers, javascript: urls, and neutralizes forms", () => {
    const dirty = `<body><h1 onclick="steal()">Acme</h1><script>track()</script><iframe src="x"></iframe><a href="javascript:evil()">x</a><form action="/submit"><input></form><a href="/shop">Shop</a></body>`;
    const clean = sanitizeSurfaceHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/<iframe/i);
    expect(clean).not.toMatch(/onclick=/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).toMatch(/onsubmit="return false"/);
    expect(clean).toContain("Acme");          // real text preserved
    expect(clean).toContain("Shop");          // real links preserved
  });
  it("keeps headings and structure for evidence context", () => {
    expect(sanitizeSurfaceHtml("<h1>Urban Americana</h1><h2>Collections</h2>")).toContain("Urban Americana");
  });
});

describe("buildSurfacePackage + primarySurfaceBody", () => {
  it("builds a package from analyzed pages, dropping empties, stamping capturedAt", () => {
    const pkg = buildSurfacePackage([{ url: "https://x.com", html: "<body><h1>X</h1><script>a()</script></body>" }, { url: "y", html: "" }], "2026-08-15T00:00:00Z");
    expect(pkg.pages).toHaveLength(1);
    expect(pkg.pages[0].html).not.toMatch(/script/);
    expect(pkg.capturedAt).toBe("2026-08-15T00:00:00Z");
  });
  it("primarySurfaceBody extracts the body of the first page; null when no surface", () => {
    const pkg = buildSurfacePackage([{ url: "u", html: "<html><body><h1>Hi</h1></body></html>" }], null);
    expect(primarySurfaceBody(pkg)).toBe("<h1>Hi</h1>");
    expect(primarySurfaceBody(null)).toBeNull();
    expect(primarySurfaceBody({ pages: [], capturedAt: null })).toBeNull();
  });
});

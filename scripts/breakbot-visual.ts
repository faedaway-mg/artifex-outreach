// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — RENDERED-BROWSER VISUAL QA HARNESS (Mandate Parts Q/R/S/T/U/V).
//
// This is the ONLY file that launches a real browser. It renders each local HTML
// fixture in headless Chromium at 2 viewports (mobile 390x844, desktop 1440x900),
// extracts real element geometry via getBoundingClientRect + computed visibility,
// hands that geometry to the PURE assessRenderedSurface() from visual-qa.ts, saves a
// screenshot as evidence, prints a table, and writes artifacts/breakbot-visual/verdict.json.
//
// SAFETY (Part V, fail-closed):
//   • renders ONLY local file:// fixtures — no network, no sends, no charges, no DB.
//   • never mutates state; only reads geometry and writes artifacts/ (gitignored).
//
// EXIT CONTRACT:
//   • Each fixture carries an EXPECTATION (which viewports must PASS, which must be
//     BLOCKED). If any surface violates its expectation, or any fixture that must PASS
//     is BLOCKED, the harness exits 1. Otherwise exit 0. This is the executable proof
//     that rendered QA actually works end-to-end.
// ─────────────────────────────────────────────────────────────────────────────
import { chromium, type Browser, type Page } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  assessRenderedSurface,
  combineVisualResults,
  VIEWPORTS,
  type Box,
  type RenderedSurface,
  type VisualQaResult,
  type VisualViewport,
} from "../src/lib/breakbot/visual-qa";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const FIXTURE_DIR = join(REPO_ROOT, "tests", "visual", "fixtures");
const OUT_DIR = join(REPO_ROOT, "artifacts", "breakbot-visual");

// The element ids the harness probes on every surface. Missing ids resolve to null
// (which the pure assertions treat as "element absent").
const PROBE_IDS = [
  "primaryCta",
  "heroTitle",
  "evidenceScreenshot",
  "personalizedVideoFrame",
  "purchaseControls",
  "stickyBar",
  "stickyBar2",
  "websiteButton",
  "heroPrice",
  "status",
] as const;

type Expectation = { pass: VisualViewport[]; blocked: VisualViewport[] };

// EXPECTATIONS encode the mandate's required PASS/BLOCKED split. Overflow is a
// mobile-only break (2000px element fits inside a 1440px desktop viewport but not
// 390px mobile). The other breaks are viewport-independent.
const FIXTURES: Record<string, { surface: string; expect: Expectation }> = {
  "offer-good.html": { surface: "offer", expect: { pass: ["mobile", "desktop"], blocked: [] } },
  "operator-good.html": { surface: "operator", expect: { pass: ["mobile", "desktop"], blocked: [] } },
  "offer-overflow.html": { surface: "offer", expect: { pass: ["desktop"], blocked: ["mobile"] } },
  "offer-price-in-hero.html": { surface: "offer", expect: { pass: [], blocked: ["mobile", "desktop"] } },
  "offer-sticky-overlap.html": { surface: "offer", expect: { pass: [], blocked: ["mobile", "desktop"] } },
};

async function extractSurface(
  page: Page,
  surface: string,
  viewport: VisualViewport,
  ids: readonly string[],
): Promise<Omit<RenderedSurface, "screenshotPath">> {
  // NOTE: no nested function declarations inside this arrow — tsx/esbuild injects a
  // `__name` helper for named functions, which is undefined in the page context and
  // throws. Keeping the body as flat inline statements keeps the serialized function
  // self-contained.
  return await page.evaluate(
    ({ surface, viewport, ids }) => {
      const elements: Record<string, Box | null> = {};
      for (const id of ids) {
        const node = document.getElementById(id);
        if (!node) {
          elements[id] = null;
          continue;
        }
        const el = node as HTMLElement;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        // "visible" mirrors what a user could actually see/interact with.
        const hidden =
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          parseFloat(style.opacity || "1") === 0 ||
          rect.width <= 0 ||
          rect.height <= 0;
        const z = parseInt(style.zIndex, 10);
        elements[id] = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          visible: !hidden,
          zIndex: Number.isNaN(z) ? undefined : z,
        };
      }
      return {
        surface,
        viewport: viewport as "mobile" | "desktop",
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        elements,
      };
    },
    { surface, viewport, ids: ids as string[] },
  );
}

type Row = {
  fixture: string;
  viewport: VisualViewport;
  status: VisualQaResult["status"];
  expected: "PASS" | "BLOCKED";
  ok: boolean;
  blockers: string[];
  screenshotPath: string;
};

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser: Browser = await chromium.launch({ headless: true });

  const rows: Row[] = [];
  const results: VisualQaResult[] = [];

  try {
    for (const [file, meta] of Object.entries(FIXTURES)) {
      const abs = join(FIXTURE_DIR, file);
      const url = pathToFileURL(abs).toString();

      for (const viewport of ["mobile", "desktop"] as VisualViewport[]) {
        const size = VIEWPORTS[viewport];
        const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.goto(url, { waitUntil: "networkidle" });

        const base = file.replace(/\.html$/, "");
        const screenshotAbs = join(OUT_DIR, `${base}-${viewport}.png`);
        await page.screenshot({ path: screenshotAbs, fullPage: false });
        const screenshotRel = join("artifacts", "breakbot-visual", `${base}-${viewport}.png`);

        const surface = await extractSurface(page, meta.surface, viewport, PROBE_IDS);
        const rendered: RenderedSurface = { ...surface, screenshotPath: screenshotRel };
        const result = assessRenderedSurface(rendered);
        results.push(result);

        const expected: "PASS" | "BLOCKED" = meta.expect.blocked.includes(viewport)
          ? "BLOCKED"
          : "PASS";
        rows.push({
          fixture: file,
          viewport,
          status: result.status,
          expected,
          ok: result.status === expected,
          blockers: result.findings.filter((f) => f.severity === "BLOCKER").map((f) => f.kind),
          screenshotPath: screenshotRel,
        });

        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const combined = combineVisualResults(results);
  const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

  console.log("\nBREAKBOT VISUAL QA — rendered-browser results\n");
  console.log(
    pad("FIXTURE", 28) + pad("VIEWPORT", 10) + pad("STATUS", 9) + pad("EXPECT", 9) + pad("OK", 4) + "BLOCKERS",
  );
  console.log("-".repeat(100));
  for (const r of rows) {
    console.log(
      pad(r.fixture, 28) +
        pad(r.viewport, 10) +
        pad(r.status, 9) +
        pad(r.expected, 9) +
        pad(r.ok ? "✓" : "✗", 4) +
        (r.blockers.length ? r.blockers.join(",") : "-"),
    );
  }

  const mismatches = rows.filter((r) => !r.ok);
  const verdict = {
    generatedAt: new Date().toISOString(),
    combinedStatus: combined.status,
    expectationsHeld: mismatches.length === 0,
    total: rows.length,
    passed: rows.filter((r) => r.status === "PASS").length,
    blocked: rows.filter((r) => r.status === "BLOCKED").length,
    mismatches: mismatches.map((r) => ({
      fixture: r.fixture,
      viewport: r.viewport,
      got: r.status,
      expected: r.expected,
    })),
    rows,
  };
  const verdictPath = join(OUT_DIR, "verdict.json");
  writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));

  console.log("\ncombined status:", combined.status);
  console.log("verdict written:", join("artifacts", "breakbot-visual", "verdict.json"));

  if (mismatches.length > 0) {
    console.error(`\nEXPECTATION VIOLATIONS (${mismatches.length}):`);
    for (const m of mismatches) {
      console.error(`  ${m.fixture} @ ${m.viewport}: got ${m.status}, expected ${m.expected}`);
    }
    process.exit(1);
  }

  console.log("\nAll fixtures matched their expected PASS/BLOCKED split. ✓");
  process.exit(0);
}

main().catch((err) => {
  console.error("breakbot-visual harness crashed:", err);
  process.exit(1);
});

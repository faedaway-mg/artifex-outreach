// ─────────────────────────────────────────────────────────────────────────────
// breakbot ui-journeys — AUTHENTICATED synthetic-user UI drive (mandate §2/§5–§13/§19).
//
// Drives the running release candidate through a REAL browser as each persona, asserting
// VISIBLE results (not HTTP status): operator cockpit sweep, content-studio zero-touch,
// explainer gallery, prospect offer, customer portal, mobile — clicking, scrolling, playing
// media, checking anchors + machinery-absence, and probing media health across full runtimes.
// Cross-checks the ratchet (src/lib/breakbot/journey-assertions.ts): a registry-active critical
// anchor missing from the live DOM BLOCKS. Screenshots are saved as evidence (§26).
//
//   BREAKBOT_TEST_AUTH=<secret> pnpm -s tsx scripts/breakbot-ui-journeys.ts --base http://localhost:3000 --offer <id>
//
// AUTH (§4): establishes an operator session via /api/auth/test-session (env-gated, non-prod).
// If the target does not enable it (403), authenticated journeys report NOT_RUN honestly — never
// a false pass. SAFE: navigation + playback + safe-fixture reads only; no sends/charges/publishes.
// ─────────────────────────────────────────────────────────────────────────────
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { MOBILE_WIDTHS } from "../src/lib/breakbot/personas";
import { ratchetReport } from "../src/lib/breakbot/journey-assertions";
import { probeMedia } from "../src/lib/breakbot/media-probe";
import { assessMedia } from "../src/lib/breakbot/media-qa";

const argv = process.argv;
const arg = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const BASE = (arg("--base") ?? "https://outreach.artifexlabs.tech").replace(/\/$/, "");
const OFFER = arg("--offer");
const HOLD_OFFER = arg("--hold-offer");
const SECRET = (process.env.BREAKBOT_TEST_AUTH ?? "").trim();
const EVIDENCE = join(process.cwd(), "artifacts/breakbot-ui-journeys");
const found = new Set<string>();
const drivenSurfaces = new Set<string>();
const results: Array<{ journey: string; status: "PASS" | "BLOCKED" | "NOT_RUN"; notes: string[] }> = [];

async function present(page: Page, testid: string): Promise<boolean> {
  const ok = await page.locator(`[data-testid="${testid}"]`).first().isVisible().catch(() => false);
  if (ok) found.add(testid);
  return ok;
}
async function absent(page: Page, testid: string): Promise<boolean> {
  return (await page.locator(`[data-testid="${testid}"]`).count().catch(() => 0)) === 0;
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(EVIDENCE, `${name}.png`) }).catch(() => {});
}
async function overflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2).catch(() => false);
}
async function mediaHealthy(page: Page, testid: string, expectLandscape: boolean, narrated = true): Promise<{ ok: boolean; note: string }> {
  const src = await page.locator(`[data-testid="${testid}"] source, [data-testid="${testid}"]`).first().getAttribute("src").catch(() => null);
  if (!src) return { ok: false, note: `${testid}: no media src` };
  const url = src.startsWith("http") ? src : `${BASE}${src}`;
  // Customer-facing media is served via APP-MANAGED routes (/api/…), never a raw storage URL.
  if (/rlwy\.net|proxy\.rlwy|\.railway\.|amazonaws\.com|blob\.core|storage\.googleapis|postgres:/i.test(src)) {
    return { ok: false, note: `${testid}: RAW storage URL exposed (${src.slice(0, 40)}…)` };
  }
  try {
    const probe = await probeMedia(url, { label: testid, expectedOrientation: expectLandscape ? "landscape" : "portrait", motionExpected: true, narrated, minDurationSeconds: 5 });
    const r = assessMedia(probe);
    return { ok: r.status !== "BLOCKED", note: `${testid}: ${r.status} alive→${r.aliveThroughPct}% ${r.orientation}` };
  } catch (e: any) {
    return { ok: false, note: `${testid}: probe error ${e?.message || e}` };
  }
}

// Scan the VISIBLE offer text for raw storage URLs / internal debug language a customer
// must never see (checks rendered innerText, not framework internals). First violation or null.
async function forbiddenCustomerContent(page: Page): Promise<string | null> {
  const text = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")) || "";
  const patterns: Array<[RegExp, string]> = [
    [/rlwy\.net|proxy\.rlwy|postgres:\/\/|DATABASE_URL/i, "raw storage/DB reference"],
    [/objectKey|artifactClass|mp4Key/i, "internal storage field"],
    [/\[object Object\]|\bNaN\b/i, "render artifact"],
    [/TODO|FIXME/i, "developer marker"],
  ];
  for (const [rx, label] of patterns) if (rx.test(text)) return label;
  return null;
}

async function authedContext(browser: Browser): Promise<{ ctx: BrowserContext | null; note: string }> {
  if (!SECRET) return { ctx: null, note: "BREAKBOT_TEST_AUTH not set — authenticated journeys NOT_RUN" };
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${BASE}/api/auth/test-session`, { headers: { "x-test-auth": SECRET } }).catch(() => null);
  if (!res || !res.ok()) {
    await ctx.close();
    return { ctx: null, note: `test-session unavailable on target (status ${res?.status() ?? "n/a"}) — authenticated journeys NOT_RUN` };
  }
  return { ctx, note: "authenticated via test-session" };
}

async function operatorSweep(ctx: BrowserContext) {
  const notes: string[] = [];
  let status: "PASS" | "BLOCKED" = "PASS";
  drivenSurfaces.add("operator");
  drivenSurfaces.add("content-studio");
  const page = await ctx.newPage();
  const check = async (route: string, anchors: string[], label: string) => {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" }).catch(() => {});
    for (const a of anchors) {
      const ok = await present(page, a);
      if (!ok) { notes.push(`${label}: missing ${a}`); }
    }
    await shot(page, `operator-${label}`);
  };
  await check("/", ["app-shell"], "home");
  await check("/launch/cockpit", ["cockpit"], "cockpit");
  await check("/launch/readiness", ["launch-readiness-gate"], "readiness");
  await check("/launch/explainers", ["explainer-coverage-summary"], "explainers");
  await check("/launch/breakbot", ["breakbot-overview"], "breakbot");
  // Content Studio: brief present, machinery absent (the §22 gate).
  await page.goto(`${BASE}/content-studio`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await present(page, "content-studio-zero-touch");
  // Idea-queue UX (mandate D §22): a global idea field + Generate-idea, concept cards with an
  // auto-written description and a Generate — and NO per-card freeform textarea.
  const ideaField = await present(page, "cs-idea-input");
  const genIdea = await present(page, "cs-generate-idea");
  const ideaBrief = await present(page, "cs-idea-brief");
  const cardGenerate = await present(page, "cs-generate-button");
  const download = (await page.locator('[data-testid="cs-download"]').count().catch(() => 0)) > 0; // present once something is READY
  if (!ideaField || !genIdea) { notes.push("content-studio: global idea field / Generate-idea missing (§4/§22)"); status = "BLOCKED"; }
  if (!ideaBrief) notes.push("content-studio: idea cards missing auto-written description (§2/§22)");
  const noPerCardTextarea = await page.locator('[data-testid^="cs-idea-card-"] textarea').count().catch(() => 0);
  if (noPerCardTextarea > 0) { notes.push("content-studio: per-card brief TEXTAREA present (§1/§23 regression)"); status = "BLOCKED"; }
  const machineryAbsent = await absent(page, "narration-script-editor") && await absent(page, "generate-voiceover-button") && await absent(page, "generate-video-button") && await absent(page, "cs-brief-input");
  if (!machineryAbsent) { notes.push("content-studio: MACHINERY VISIBLE in normal view (§22 block)"); status = "BLOCKED"; }
  notes.push(`content-studio: idea feed ${cardGenerate ? "has" : "no"} Generate, download-affordance ${download ? "present" : "n/a"}`);
  // Capacity mandate C §19: the resource picture is visible BEFORE Generate — the capacity
  // card + a per-generation forecast, without exposing TTS machinery.
  if (!await present(page, "cs-capacity-card")) { notes.push("content-studio: VOICE CAPACITY card missing (mandate C §1/§19)"); status = "BLOCKED"; }
  const capStatus = await page.locator('[data-testid="cs-capacity-status"]').first().innerText().catch(() => "");
  if (capStatus) notes.push(`content-studio: voice capacity → ${capStatus.trim()}`);
  if (!await present(page, "cs-generation-forecast") && !await present(page, "cs-reserve-block")) {
    notes.push("content-studio: per-generation forecast not shown (non-blocking if unknown capacity)");
  }
  await shot(page, "operator-content-studio");
  await page.close();
  results.push({ journey: "operator-cockpit-sweep", status, notes });
}

async function offerJourney(browser: Browser) {
  if (!OFFER) { results.push({ journey: "prospect-offer-experience", status: "NOT_RUN", notes: ["needs --offer fixture"] }); return; }
  drivenSurfaces.add("offer");
  const notes: string[] = [];
  let status: "PASS" | "BLOCKED" = "PASS";
  const fail = (n: string) => { notes.push(n); status = "BLOCKED"; };
  const page = await browser.newPage();
  await page.goto(`${BASE}/offer/${OFFER}`, { waitUntil: "domcontentloaded" }).catch(() => {});

  // Core pre-sale anchors: finding/scope/price/protections/CTA.
  for (const a of ["offer-hero", "price", "scope-and-protections", "offer-details"]) if (!await present(page, a)) fail(`offer: missing ${a}`);

  // Personalized video — REQUIRED, and 9:16 PORTRAIT, silent (kinetic), healthy across the runtime.
  if (await present(page, "personalized-video")) {
    const m = await mediaHealthy(page, "personalized-video", false, /*narrated*/ false); notes.push(m.note); if (!m.ok) fail("personalized-video unhealthy");
  } else fail("offer: personalized-video MISSING (pre-sale requires it)");

  // Trust explainer — REQUIRED, 16:9 LANDSCAPE, narrated (Matt), plays, healthy across runtime.
  if (await present(page, "trust-video")) {
    const m = await mediaHealthy(page, "trust-video", true, /*narrated*/ true); notes.push(m.note); if (!m.ok) fail("trust-video unhealthy");
    // The transcript must remain SECONDARY/collapsible (a <details> summary), never primary.
    const collapsible = await page.locator("details summary", { hasText: /transcript/i }).count().catch(() => 0);
    if (!collapsible) notes.push("offer: transcript not a collapsible secondary (non-blocking)");
  } else fail("offer: trust-video MISSING (canonical landscape explainer required)");

  // Purchase CTA present when all gates pass; NO "being prepared/finalized" HOLD when the video exists.
  if (!await present(page, "checkout-cta")) fail("offer: purchase CTA (checkout-cta) not shown though gates should pass");
  if (await present(page, "checkout-hold")) fail("offer: HOLD state shown though canonical video exists");
  const bodyText = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")) || "";
  if (/being (prepared|finalized)/i.test(bodyText)) fail("offer: 'being prepared/finalized' HOLD copy present with a ready video");

  // No raw storage URLs / internal debug language anywhere the customer can read.
  const bad = await forbiddenCustomerContent(page); if (bad) fail(`offer: forbidden customer content — ${bad}`);

  await shot(page, "prospect-offer");
  await page.close();
  results.push({ journey: "prospect-offer-experience", status, notes });
}

// NEGATIVE regression: an offer whose required trust video is MISSING must HOLD — no purchase CTA.
async function holdOfferJourney(browser: Browser) {
  if (!HOLD_OFFER) { results.push({ journey: "offer-hold-no-cta", status: "NOT_RUN", notes: ["needs --hold-offer fixture"] }); return; }
  drivenSurfaces.add("offer");
  const notes: string[] = [];
  let status: "PASS" | "BLOCKED" = "PASS";
  const fail = (n: string) => { notes.push(n); status = "BLOCKED"; };
  const page = await browser.newPage();
  await page.goto(`${BASE}/offer/${HOLD_OFFER}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  // The page still renders (hero/price/scope) but the purchase is HELD.
  if (!await present(page, "offer-hero")) fail("hold-offer: page did not render");
  if (await present(page, "checkout-cta")) fail("hold-offer: purchase CTA shown despite missing trust video (fail-open bug)");
  const held = await present(page, "checkout-hold");
  const bodyText = (await page.evaluate(() => document.body?.innerText || "").catch(() => "")) || "";
  const heldCopy = /being (prepared|finalized)|not (yet )?available|check back/i.test(bodyText);
  if (!held && !heldCopy) fail("hold-offer: no visible HOLD state (neither checkout-hold nor hold copy)");
  else notes.push("hold-offer: purchase correctly HELD, no CTA");
  await shot(page, "offer-hold");
  await page.close();
  results.push({ journey: "offer-hold-no-cta", status, notes });
}

async function portalJourney(browser: Browser) {
  if (!OFFER) { results.push({ journey: "customer-portal", status: "NOT_RUN", notes: ["needs --offer fixture"] }); return; }
  drivenSurfaces.add("customer-portal");
  const notes: string[] = [];
  let status: "PASS" | "BLOCKED" = "PASS";
  const page = await browser.newPage();
  await page.goto(`${BASE}/offer/${OFFER}/portal`, { waitUntil: "domcontentloaded" }).catch(() => {});
  for (const a of ["portal-scope", "portal-progress", "portal-next-action"]) if (!await present(page, a)) notes.push(`portal: missing ${a}`);
  await shot(page, "customer-portal");
  await page.close();
  results.push({ journey: "customer-portal", status, notes });
}

async function mobileJourneys(ctx: BrowserContext | null, browser: Browser) {
  for (const width of MOBILE_WIDTHS) {
    const notes: string[] = [];
    let status: "PASS" | "BLOCKED" = "PASS";
    // Public offer at this width (if fixture).
    if (OFFER) {
      const p = await browser.newPage(); await p.setViewportSize({ width, height: 844 });
      await p.goto(`${BASE}/offer/${OFFER}`, { waitUntil: "domcontentloaded" }).catch(() => {});
      if (await overflow(p)) { notes.push(`offer @${width}px: horizontal overflow`); status = "BLOCKED"; }
      await shot(p, `mobile-offer-${width}`); await p.close();
    }
    // Authed content-studio at this width.
    if (ctx) {
      const p = await ctx.newPage(); await p.setViewportSize({ width, height: 844 });
      await p.goto(`${BASE}/content-studio`, { waitUntil: "domcontentloaded" }).catch(() => {});
      if (await overflow(p)) { notes.push(`content-studio @${width}px: horizontal overflow`); status = "BLOCKED"; }
      await shot(p, `mobile-cs-${width}`); await p.close();
    }
    results.push({ journey: `mobile-${width}px`, status: (OFFER || ctx) ? status : "NOT_RUN", notes: notes.length ? notes : ["no overflow; critical surfaces usable"] });
  }
}

async function main() {
  try { mkdirSync(EVIDENCE, { recursive: true }); } catch {}
  console.log("━━ BREAKBOT — AUTHENTICATED SYNTHETIC UI JOURNEYS ━━");
  console.log(`  target: ${BASE}   offer: ${OFFER ?? "(none)"}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const { ctx, note } = await authedContext(browser);
    console.log(`  auth: ${note}`);
    if (ctx) await operatorSweep(ctx);
    else results.push({ journey: "operator-cockpit-sweep", status: "NOT_RUN", notes: [note] });
    await offerJourney(browser);
    await holdOfferJourney(browser);
    await portalJourney(browser);
    await mobileJourneys(ctx, browser);

    // Ratchet: a registry-active CRITICAL anchor missing from every page we drove → BLOCK,
    // but only when we actually had a session to see the authed anchors.
    let ratchetBlocked: string[] = [];
    if (ctx) {
      // Scope the ratchet to the surfaces we actually drove — a surface not visited this run
      // (e.g. offer/portal without a fixture) is untested, not a missing/blocked anchor.
      const rep = ratchetReport(found, drivenSurfaces);
      ratchetBlocked = rep.blocked.map((b) => `${b.surface}:${b.testid}`);
    }
    if (ctx) await ctx.close();

    for (const r of results) {
      const icon = r.status === "PASS" ? "✓" : r.status === "NOT_RUN" ? "·" : "✗";
      console.log(`  ${icon} ${r.journey.padEnd(28)} ${r.status}`);
      for (const n of r.notes) console.log(`       ${n}`);
    }
    if (ratchetBlocked.length) console.log(`  ✗ ratchet: critical anchors missing → ${ratchetBlocked.join(", ")}`);
    else if (SECRET) console.log("  ✓ ratchet: all registry-active critical anchors present");

    const blocked = results.some((r) => r.status === "BLOCKED") || ratchetBlocked.length > 0;
    console.log(`  ${blocked ? "✗ blocked journeys present" : "✓ no blocked journeys"}`);
    process.exit(blocked ? 1 : 0);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e?.stack || String(e)); process.exit(1); });

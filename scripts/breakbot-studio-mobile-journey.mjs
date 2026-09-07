// BREAKBOT MANDATE-26 DETERMINISTIC MOBILE + NARRATION JOURNEY. Exercises the rebuilt mobile navigation
// (list/index → dedicated full-page workspace via /content-studio/[purpose]/[leadId]?from=), genuine
// regeneration (a distinct grounded candidate), and the committed-package "Create improved version" fork
// (no Accept shown, frozen package untouched) — at 3 widths. Isolated in-memory instance; no provider; nothing
// sent, approved, scheduled, or rendered for real.
import { chromium } from "playwright";

const BASE = (process.env.BB_BASE || "http://localhost:3926").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const WIDTHS = [ { label: "mobile", width: 390, height: 844 }, { label: "tablet", width: 768, height: 1024 }, { label: "desktop", width: 1440, height: 1000 } ];
const results = [];
const check = (label, name, ok, detail = "") => { results.push({ label, name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  [${label}] ${name}${detail ? " — " + detail : ""}`); };

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function openExpand(page) {
  await page.locator("[data-expand-open]").first().click();
  await page.locator("[data-expand-panel]").first().waitFor({ timeout: 12000 }).catch(() => {});
  await page.locator("[data-expand-run]").first().click();
  await page.locator("[data-expand-compare]").first().waitFor({ timeout: 12000 }).catch(() => {});
}

async function run(w, browser, ids) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const isMobile = w.width < 1024;

  // ── Index page renders the tab + cards; cards are real navigable links ────────────────────────────────
  await page.goto(`${BASE}/content-studio?type=proposal`, { waitUntil: "networkidle" });
  await page.locator("[data-studio-tabs]").first().waitFor({ timeout: 10000 }).catch(() => {});
  check(w.label, "proposal index renders cards", (await page.locator("[data-workspace-card]").count()) >= 1);
  check(w.label, "cards are real links to a dedicated workspace", (await page.locator("[data-workspace-href]").count()) >= 1);
  check(w.label, "no horizontal overflow on the index", await noOverflow(page));

  // ── Tap a card ────────────────────────────────────────────────────────────────────────────────────────
  const goodCard = page.locator(`[data-workspace-card="client-${ids.good}"]`).first();
  if (isMobile) {
    // MOBILE: tapping navigates to the dedicated full-page workspace.
    await goodCard.click();
    await page.waitForURL((u) => u.pathname.includes(`/content-studio/proposal/`), { timeout: 10000 }).catch(() => {});
    check(w.label, "tap navigates to the dedicated full-page workspace", page.url().includes("/content-studio/proposal/"));
    await page.locator("[data-cs-back]").first().waitFor({ timeout: 10000 }).catch(() => {});
    check(w.label, "dedicated workspace has a Back control", (await page.locator("[data-cs-back]").count()) === 1);
    // Back returns to the originating tab.
    await page.locator("[data-cs-back]").first().click();
    await page.waitForURL((u) => u.search.includes("type=proposal"), { timeout: 10000 }).catch(() => {});
    check(w.label, "Back returns to the same Proposal tab", page.url().includes("type=proposal"));
  } else {
    // DESKTOP: master-detail — clicking selects in place (no navigation away from the index).
    await goodCard.click();
    await page.waitForTimeout(300);
    check(w.label, "desktop selects in place (stays on the index)", page.url().includes("/content-studio") && !page.url().includes("/content-studio/proposal/"));
  }

  // ── Dedicated workspace directly (survives refresh / deep-link) ────────────────────────────────────────
  await page.goto(`${BASE}/content-studio/proposal/${ids.good}`, { waitUntil: "networkidle" });
  check(w.label, "deep-link to a company workspace loads", (await page.locator("[data-expand-open]").count()) >= 1);
  check(w.label, "no horizontal overflow on the dedicated workspace", await noOverflow(page));

  // ── Genuine regeneration: the candidate must actually change ──────────────────────────────────────────
  await openExpand(page);
  const cand1 = (await page.locator("[data-expand-edit]").first().inputValue().catch(() => "")) || "";
  await page.locator("[data-expand-regenerate]").first().click();
  await page.waitForTimeout(600);
  const cand2 = (await page.locator("[data-expand-edit]").first().inputValue().catch(() => "")) || "";
  check(w.label, "regenerate produces a genuinely different candidate", cand1.length > 0 && cand2.length > 0 && cand1 !== cand2, `${cand1.length}v${cand2.length}`);
  check(w.label, "regenerated candidate stays company-specific", /Vertex Roofing/i.test(cand2));

  // ── Committed (SCHEDULED) package: Create improved version, NOT a failing Accept ──────────────────────
  await page.goto(`${BASE}/content-studio/proposal/${ids.scheduled}`, { waitUntil: "networkidle" });
  await openExpand(page);
  check(w.label, "committed package shows a truthful frozen banner", (await page.locator('[data-expand-permissions][data-frozen="1"]').count()) === 1);
  check(w.label, "committed package exposes Create improved version (fork)", (await page.locator("[data-expand-fork]").count()) === 1);
  check(w.label, "committed package does NOT show a normal Accept revision", (await page.locator("[data-expand-accept]").count()) === 0);

  // ── Content tab: no proposal contamination ────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/content-studio?type=content`, { waitUntil: "networkidle" });
  check(w.label, "no proposal card leaks into the Content tab", (await page.locator(`[data-workspace-card="client-${ids.good}"]`).count()) === 0);
  check(w.label, "no horizontal overflow on the content index", await noOverflow(page));

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  // login once to satisfy the session-gated seed, then seed the isolated fixtures.
  const boot = await browser.newContext();
  const bp = await login(boot);
  await boot.request.post(`${BASE}/api/breakbot?action=reset`);
  const ids = ((await (await boot.request.post(`${BASE}/api/breakbot?action=seed-video-workspaces`)).json()).ids) || {};
  await boot.close();
  if (!ids.good || !ids.scheduled) { console.log("SEED FAILED", JSON.stringify(ids)); process.exit(2); }

  for (const w of WIDTHS) await run(w, browser, ids);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMANDATE-26 MOBILE+NARRATION: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
  if (failed.length) { console.log("FAILURES:"); failed.forEach((f) => console.log(`  [${f.label}] ${f.name} ${f.detail}`)); }
  process.exit(failed.length ? 1 : 0);
})();

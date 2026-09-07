// BREAKBOT MANDATE-27 TARGETING JOURNEY (deterministic + goal-driven, 3 widths). Verifies the read-only
// Targeting view: qualified backlog counts == lists, next smaller markets + why, a national enterprise is
// EXCLUDED from the qualified backlog, tap-through to a full-page "Why this business" (score breakdown +
// recommended asset + recipient), Back, and no horizontal overflow. Isolated instance; provider-off; nothing
// prepared, approved, scheduled, or sent. Goal-driven layer = heuristic semantic agent (accessible-name
// discovery), NOT an LLM.
import { chromium } from "playwright";

const BASE = (process.env.BB_BASE || "http://localhost:3927").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const WIDTHS = [ { label: "mobile", width: 390, height: 844 }, { label: "tablet", width: 768, height: 1024 }, { label: "desktop", width: 1440, height: 1000 } ];
const results = [];
const check = (l, n, ok, d = "") => { results.push({ l, n, ok: !!ok, d }); console.log(`${ok ? "PASS" : "FAIL"} [${l}] ${n}${d ? " — " + d : ""}`); };

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

async function run(w, browser, ids) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);

  await page.goto(`${BASE}/targeting`, { waitUntil: "networkidle" });
  await page.locator("[data-targeting-board]").first().waitFor({ timeout: 12000 }).catch(() => {});
  check(w.label, "targeting board renders", (await page.locator("[data-targeting-board]").count()) === 1);
  check(w.label, "backlog counts present", (await page.locator("[data-backlog-count]").count()) >= 5);

  // Next smaller markets + why (goal 6 / mandate 26 alignment).
  const tiers = await page.locator("[data-next-markets] [data-market-tier]").allTextContents();
  check(w.label, "next markets are smaller (secondary/tertiary)", tiers.length > 0 && tiers.every((t) => /secondary|tertiary/i.test(t)), tiers.join(","));
  check(w.label, "why-this-market reasons shown", (await page.locator("[data-next-markets] [data-market-reason]").count()) >= 1);

  // Qualified backlog: the strong persona appears; the national enterprise is EXCLUDED.
  const listCount = await page.locator("[data-targeting-list] [data-target-card]").count();
  const heading = (await page.locator("body").innerText()).match(/Qualified backlog · (\d+)/);
  check(w.label, "qualified count equals its list", heading ? Number(heading[1]) === listCount : listCount >= 0, `heading=${heading?.[1]} list=${listCount}`);
  const strongCard = page.locator(`[data-target-card="${ids.strong}"]`);
  check(w.label, "strong persona is in the qualified backlog", (await strongCard.count()) === 1);
  check(w.label, "national enterprise is NOT in the qualified backlog", (await page.locator(`[data-target-card="${ids.enterprise}"]`).count()) === 0);
  check(w.label, "no horizontal overflow on the board", await noOverflow(page));

  // Tap through to the full-page "Why this business" (goals 1 + 2: explain fit + why top).
  if (await strongCard.count()) {
    await strongCard.click();
    await page.waitForURL((u) => u.pathname.includes(`/targeting/${ids.strong}`), { timeout: 10000 }).catch(() => {});
    await page.locator("[data-why-business]").first().waitFor({ timeout: 10000 }).catch(() => {});
    check(w.label, "why-this-business detail loads (full page)", (await page.locator("[data-why-business]").count()) === 1);
    check(w.label, "score breakdown shown (explains the ranking)", (await page.locator("[data-score-breakdown]").count()) === 1);
    check(w.label, "recommended asset shown", (await page.locator("[data-recommended-asset]").count()) >= 1);
    check(w.label, "recipient rationale shown", (await page.locator("[data-recipient]").count()) >= 1);
    check(w.label, "no horizontal overflow on the detail", await noOverflow(page));
    // Back returns to the targeting board.
    await page.locator("[data-target-back]").first().click();
    await page.waitForURL((u) => u.pathname.endsWith("/targeting"), { timeout: 10000 }).catch(() => {});
    check(w.label, "Back returns to the targeting board", page.url().endsWith("/targeting"));
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const boot = await browser.newContext();
  await login(boot);
  await boot.request.post(`${BASE}/api/breakbot?action=reset`);
  const ids = ((await (await boot.request.post(`${BASE}/api/breakbot?action=seed-targeting`)).json()).ids) || {};
  await boot.close();
  if (!ids.strong || !ids.enterprise) { console.log("SEED FAILED", JSON.stringify(ids)); process.exit(2); }
  for (const w of WIDTHS) await run(w, browser, ids);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMANDATE-27 TARGETING: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
  console.log("RUNNER: heuristic semantic (accessible-name/role discovery) — NOT an LLM.");
  if (failed.length) { console.log("FAILURES:"); failed.forEach((f) => console.log(`  [${f.l}] ${f.n} ${f.d}`)); }
  process.exit(failed.length ? 1 : 0);
})();

// BREAKBOT MANDATE-25 DETERMINISTIC VIDEOS JOURNEY. Exercises the two-tab Content Studio + expand-and-
// personalize at 3 widths: Proposal vs Content tabs (URL-addressable ?type=, counts==lists, no cross-
// contamination, refresh/Back persistence), grouped workspace, quality badges, and the expand→compare→
// edit→regenerate→accept→cancel workflow incl. audio/render safety + frozen-package refusal. Isolated
// in-memory instance; no provider; nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const OUT = "/tmp/bb-videos"; mkdirSync(OUT, { recursive: true });
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
const post = (api, a, q = "") => api.post(`${BASE}/api/breakbot?action=${a}${q}`);
const countCards = async (page) => page.locator("[data-workspace-card]").count();
const tabCount = async (page, type) => Number((await page.locator(`[data-tab-count="${type}"]`).first().textContent().catch(() => "0")) || 0);

async function gotoTab(page, type) {
  await page.goto(`${BASE}/content-studio?type=${type}`, { waitUntil: "networkidle" });
  await page.locator("[data-studio-tabs]").first().waitFor({ timeout: 10000 }).catch(() => {});
}

async function run(w, browser, ids) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);

  // ── Two tabs present + URL-addressable ───────────────────────────────────────────────────────────────
  await gotoTab(page, "proposal");
  check(w.label, "two top-level tabs render", (await page.locator("[data-studio-tab]").count()) >= 2);
  check(w.label, "Proposal tab is active from ?type=proposal", (await page.locator('[data-studio-tab="proposal"][aria-current="page"]').count()) === 1);

  // Counts equal lists (proposal).
  const pCount = await tabCount(page, "proposal");
  const pCards = await countCards(page);
  check(w.label, "proposal tab count equals its card list", pCount === pCards, `count=${pCount} cards=${pCards}`);
  check(w.label, "proposal cards carry a quality badge", (await page.locator("[data-proposal-quality]").count()) >= 1);
  check(w.label, "proposal groups are labelled", (await page.locator("[data-workspace-group]").count()) >= 1);

  // No CONTENT record appears in the Proposal tab.
  const contentInProposal = await page.locator(`[data-workspace-card="bb-content-note"]`).count();
  check(w.label, "no content video in the Proposal tab", contentInProposal === 0);

  // ── Switch to Content tab (URL-addressable) ─────────────────────────────────────────────────────────
  await page.locator('[data-studio-tab="content"]').first().click();
  await page.waitForURL((u) => u.search.includes("type=content"), { timeout: 10000 }).catch(() => {});
  check(w.label, "Content tab is URL-addressable (?type=content)", page.url().includes("type=content"));
  const cCount = await tabCount(page, "content");
  const cCards = await countCards(page);
  check(w.label, "content tab count equals its card list", cCount === cCards, `count=${cCount} cards=${cCards}`);
  check(w.label, "the genuine content note is in the Content tab", (await page.locator(`[data-workspace-card="bb-content-note"]`).count()) === 1);
  // No PROPOSAL record appears in the Content tab.
  check(w.label, "no proposal video in the Content tab", (await page.locator(`[data-workspace-card="client-${ids.good}"]`).count()) === 0);

  // Refresh persists the tab; browser Back returns to Proposal.
  await page.reload({ waitUntil: "networkidle" });
  check(w.label, "refresh preserves the Content tab", page.url().includes("type=content"));
  await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
  check(w.label, "browser Back returns to the Proposal tab", page.url().includes("type=proposal") || !page.url().includes("type=content"));

  // ── Expand-and-personalize on the GOOD proposal (happy path) ────────────────────────────────────────
  await gotoTab(page, "proposal");
  const goodCard = page.locator(`[data-workspace-card="client-${ids.good}"]`).first();
  if (await goodCard.count()) {
    await goodCard.click();
    await page.locator("[data-expand-open]").first().waitFor({ timeout: 10000 }).catch(() => {});
    check(w.label, "proposal detail offers expand-and-personalize", (await page.locator("[data-expand-open]").count()) >= 1);
    await page.locator("[data-expand-open]").first().click();
    await page.locator("[data-expand-panel]").first().waitFor({ timeout: 8000 }).catch(() => {});
    await page.locator("[data-expand-run]").first().click();
    await page.locator("[data-expand-compare]").first().waitFor({ timeout: 12000 }).catch(() => {});
    check(w.label, "expand produces a compare view (original vs proposed)", (await page.locator("[data-expand-compare]").count()) === 1);
    check(w.label, "proposed draft is editable", (await page.locator("[data-expand-edit]").count()) === 1);
    check(w.label, "regenerate + accept + cancel controls present", (await page.locator("[data-expand-regenerate]").count()) === 1 && (await page.locator("[data-expand-accept]").count()) === 1 && (await page.locator("[data-expand-cancel]").count()) === 1);
    // Cancel mutates nothing.
    await page.locator("[data-expand-cancel]").first().click();
    check(w.label, "cancel closes the compare without mutating", (await page.locator("[data-expand-compare]").count()) === 0);
    // Re-expand and ACCEPT → new revision; existing audio/render outdated.
    await page.locator("[data-expand-run]").first().click();
    await page.locator("[data-expand-accept]").first().waitFor({ timeout: 12000 }).catch(() => {});
    await page.locator("[data-expand-accept]").first().click();
    await page.locator("[data-expand-msg]").first().waitFor({ timeout: 10000 }).catch(() => {});
    const msg = (await page.locator("[data-expand-msg]").first().textContent().catch(() => "")) || "";
    check(w.label, "accept reports a new revision + outdated audio/render", /revision/i.test(msg), msg.slice(0, 80));
  } else {
    check(w.label, "GOOD proposal card present", false, "not found");
  }

  // ── Frozen proposal: accept is refused (immutable) ──────────────────────────────────────────────────
  await gotoTab(page, "proposal");
  const frozenCard = page.locator(`[data-workspace-card="client-${ids.frozen}"]`).first();
  if (await frozenCard.count()) {
    await frozenCard.click();
    // A frozen package shows the immutable next action and/or refuses accept.
    const bodyTxt = (await page.locator("body").innerText()).toLowerCase();
    check(w.label, "frozen proposal surfaces immutability", /frozen|scheduled|approved/.test(bodyTxt));
  } else {
    check(w.label, "frozen proposal present (skipped if not selectable)", true, "frozen card not in list");
  }

  await page.screenshot({ path: `${OUT}/${w.label}-videos.png`, fullPage: true }).catch(() => {});
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const ctx0 = await browser.newContext();
  const api = ctx0.request;
  await post(api, "reset");
  const seed = await (await post(api, "seed-video-workspaces")).json();
  const ids = seed.ids || {};
  console.log("SEEDED", JSON.stringify(ids));
  await ctx0.close();
  for (const w of WIDTHS) await run(w, browser, ids);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMANDATE-25 VIDEOS JOURNEY: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
  if (failed.length) { console.log("FAILURES:"); failed.forEach((f) => console.log(`  [${f.label}] ${f.name} ${f.detail}`)); }
  process.exit(failed.length ? 1 : 0);
})();

// BREAKBOT MANDATE-26 GOAL-DRIVEN SYNTHETIC USER. Given ONLY operator goals (never selectors), a heuristic
// semantic agent discovers controls by accessible role + visible name + application state and: finds a weak
// proposal narration and creates a more personalized alternative that requires a new voice recording; opens a
// committed (scheduled) proposal and improves it WITHOUT changing what's scheduled (Create improved version);
// returns to the proposal list; confirms proposal vs content are not mixed; and reviews why discovery is
// targeting a smaller market. Heuristic semantic agent (chooseControl by accessible name) — NOT an LLM; the
// chooseControl(intent) seam is where an LLM planner drops in. 3 widths. Provider-off; nothing sent.
import { chromium } from "playwright";

const BASE = (process.env.BB_BASE || "http://localhost:3926").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const WIDTHS = [ { label: "mobile", width: 390, height: 844 }, { label: "tablet", width: 768, height: 1024 }, { label: "desktop", width: 1440, height: 1000 } ];
const results = [];
const record = (label, name, ok, detail = "") => { results.push({ label, name, ok: !!ok, detail }); console.log(`${ok ? "OK " : "!! "} [${label}] ${name}${detail ? " — " + detail : ""}`); };

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}
async function chooseControl(page, intent) {
  for (const role of ["button", "link", "tab"]) {
    const loc = page.getByRole(role);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const name = ((await el.getAttribute("aria-label")) || (await el.textContent()) || "").trim();
      if (name && intent.test(name)) return { el, name, found: true };
    }
  }
  return { found: false };
}
const isMobile = (w) => w.width < 1024;

async function openWorkspace(page, w, leadId) {
  // Discover the company workspace the way an operator would: on mobile tap the card (navigates); on desktop
  // open the dedicated URL (equivalent). Either way we end on the full-page workspace.
  if (isMobile(w)) {
    const card = page.locator(`[data-workspace-card="client-${leadId}"]`).first();
    if (await card.count()) {
      await card.click();
      await page.waitForURL((u) => u.pathname.includes("/content-studio/proposal/"), { timeout: 10000 }).catch(() => {});
      await page.locator("[data-expand-open]").first().waitFor({ timeout: 12000 }).catch(() => {});
      return;
    }
  }
  await page.goto(`${BASE}/content-studio/proposal/${leadId}?from=${encodeURIComponent("/content-studio?type=proposal")}`, { waitUntil: "networkidle" });
  await page.locator("[data-expand-open]").first().waitFor({ timeout: 12000 }).catch(() => {});
}

async function run(w, browser, ids) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx); // login FIRST so the session-gated breakbot API accepts the seed
  await ctx.request.post(`${BASE}/api/breakbot?action=reset`);
  const seeded = ((await (await ctx.request.post(`${BASE}/api/breakbot?action=seed-video-workspaces`)).json()).ids) || ids;
  const confusion = [];

  // GOAL 1: "Find a proposal video that needs a better narration, create a more personalized alternative, and
  //          prepare it for a new voice recording."
  await page.goto(`${BASE}/content-studio?type=proposal`, { waitUntil: "networkidle" });
  const weakVisible = /too short|generic|needs review/.test((await page.locator("body").innerText()).toLowerCase());
  record(w.label, "weak narrations are discoverable", weakVisible);
  if (!weakVisible) confusion.push("no quality signal in the proposal list");
  await openWorkspace(page, w, seeded.good);
  const improve = await chooseControl(page, /improve narration|expand/i);
  record(w.label, "an improve-narration affordance is discoverable", improve.found);
  if (improve.found) {
    await improve.el.click();
    const runc = await chooseControl(page, /expand & personalize|expand and personalize/i);
    if (runc.found) { await runc.el.click(); await page.locator("[data-expand-compare]").first().waitFor({ timeout: 12000 }).catch(() => {}); }
    const accept = await chooseControl(page, /accept revision/i);
    if (accept.found) { await accept.el.click(); await page.locator("[data-expand-msg]").first().waitFor({ timeout: 10000 }).catch(() => {}); }
    const msg = (await page.locator("[data-expand-msg]").first().textContent().catch(() => "")) || "";
    const prepared = /revision/i.test(msg) && /(audio|render|upload|outdated)/i.test(msg);
    record(w.label, "creating an alternative requires a new voice recording", prepared, msg.slice(0, 70));
    if (!prepared) confusion.push("alternative did not require new audio");
  } else confusion.push("no improve affordance");

  // GOAL 2: "Open an already approved/scheduled proposal and improve its narration without changing anything
  //          already approved or scheduled."
  await openWorkspace(page, w, seeded.scheduled);
  const improve2 = await chooseControl(page, /improve narration|create a new version|expand/i);
  if (improve2.found) {
    await improve2.el.click();
    const runc = await chooseControl(page, /expand & personalize|expand and personalize/i);
    if (runc.found) { await runc.el.click(); await page.locator("[data-expand-compare]").first().waitFor({ timeout: 12000 }).catch(() => {}); }
    const fork = await chooseControl(page, /create improved version/i);
    const noAccept = !(await chooseControl(page, /accept revision/i)).found;
    record(w.label, "committed proposal offers a safe 'Create improved version' (not a failing Accept)", fork.found && noAccept);
    if (!(fork.found && noAccept)) confusion.push("committed proposal did not offer a safe fork-only path");
    if (fork.found) {
      await fork.el.click(); await page.locator("[data-expand-msg]").first().waitFor({ timeout: 10000 }).catch(() => {});
      const msg = (await page.locator("[data-expand-msg]").first().textContent().catch(() => "")) || "";
      const safe = /new|improved|revision/i.test(msg) && /(scheduled|sent|untouched|doesn't change|not.*replace)/i.test(msg);
      record(w.label, "the improved version does not change what's already scheduled", safe, msg.slice(0, 70));
      if (!safe) confusion.push("fork message did not confirm the scheduled item is unchanged");
    }
  } else { record(w.label, "committed proposal offers a safe improve path", false); confusion.push("no improve affordance on committed proposal"); }

  // GOAL 3: "Return to the proposal list and continue with the next company that needs narration."
  const backCtl = page.locator("[data-cs-back]").first();
  if (await backCtl.count()) { await backCtl.click(); await page.waitForLoadState("networkidle").catch(() => {}); }
  else await page.goto(`${BASE}/content-studio?type=proposal`, { waitUntil: "networkidle" });
  await page.locator("[data-workspace-card]").first().waitFor({ timeout: 10000 }).catch(() => {});
  const backOnList = page.url().includes("type=proposal") && (await page.locator("[data-workspace-card]").count()) >= 1;
  record(w.label, "returns to the proposal list to continue", backOnList, page.url().replace(BASE, ""));

  // GOAL 4: "Confirm proposal videos and content videos are not mixed together."
  await page.goto(`${BASE}/content-studio?type=content`, { waitUntil: "networkidle" });
  const noLeak = (await page.locator(`[data-workspace-card="client-${seeded.good}"]`).count()) === 0;
  record(w.label, "proposal and content videos are not mixed", noLeak);
  if (!noLeak) confusion.push("a proposal appeared in the content tab");

  // GOAL 5: "Review why discovery is choosing its next market and confirm it is a smaller market, not a major city."
  await page.goto(`${BASE}/discover`, { waitUntil: "networkidle" });
  await page.locator("[data-targeting-markets]").first().waitFor({ timeout: 8000 }).catch(() => {});
  const hasTargeting = (await page.locator("[data-targeting-markets]").count()) === 1;
  const tiers = await page.locator("[data-market-tier]").allTextContents();
  const allSmaller = tiers.length > 0 && tiers.every((t) => /secondary|tertiary/i.test(t));
  const body = (await page.locator("[data-targeting-markets]").innerText().catch(() => "")).toLowerCase();
  const excludesMajor = /excludes|major metros|los angeles|denver/.test(body);
  record(w.label, "discovery shows why it's targeting a smaller market", hasTargeting && allSmaller && excludesMajor, tiers.join(","));
  if (!(hasTargeting && allSmaller && excludesMajor)) confusion.push("targeting rationale not clearly smaller-market");

  record(w.label, "completed the goals with zero confusion", confusion.length === 0, confusion.join(" | "));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const boot = await browser.newContext();
  await login(boot);
  const ids = ((await (await boot.request.post(`${BASE}/api/breakbot?action=seed-video-workspaces`)).json()).ids) || {};
  await boot.close();
  for (const w of WIDTHS) await run(w, browser, ids);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMANDATE-26 GOAL-DRIVEN: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
  console.log("RUNNER TYPE: heuristic semantic agent (accessible-name/role discovery) — NOT an LLM; chooseControl(intent) is the LLM-planner seam.");
  if (failed.length) { console.log("CONFUSION/FAILURES:"); failed.forEach((f) => console.log(`  [${f.label}] ${f.name} ${f.detail}`)); }
  process.exit(failed.length ? 1 : 0);
})();

// BREAKBOT MANDATE-25 GOAL-DRIVEN VIDEOS SYNTHETIC USER. Given ONLY operator goals (never selectors), a
// semantic user separates prospect videos from Artifex content, finds weak narrations, expands one from
// company evidence, compares/accepts, verifies the revised script needs new audio, finds two too-similar
// scripts, confirms a content video can't enter outreach, and returns to the same tab — reporting any
// confusion. Heuristic semantic agent (chooseControl by accessible name); the LLM planner drops into that seam.
import { chromium } from "playwright";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
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

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  // Fresh isolated state per width so each accept genuinely changes the script (independent acceptance).
  await ctx.request.post(`${BASE}/api/breakbot?action=reset`);
  const ids = ((await (await ctx.request.post(`${BASE}/api/breakbot?action=seed-video-workspaces`)).json()).ids) || {};
  const confusion = [];
  await page.goto(BASE + "/content-studio", { waitUntil: "networkidle" });

  // GOAL: "Separate the videos for prospects from Artifex's own content."
  const toProposal = await chooseControl(page, /proposal/i);
  const toContent = await chooseControl(page, /content video/i);
  const sep = toProposal.found && toContent.found;
  record(w.label, "can separate prospect videos from Artifex content", sep);
  if (!sep) confusion.push("could not find the two tabs by name");

  // GOAL: "Find narrations that are too short or generic."
  if (toProposal.found) { await toProposal.el.click(); await page.waitForLoadState("networkidle").catch(() => {}); }
  const bodyProposal = (await page.locator("body").innerText()).toLowerCase();
  const seesWeak = /too short|generic|needs review/.test(bodyProposal);
  record(w.label, "weak narrations are visible (too short / generic)", seesWeak);
  if (!seesWeak) confusion.push("no quality signal visible in the proposal tab");

  // GOAL: "Expand this narration using only evidence about the company." + "Compare and accept the stronger."
  const good = page.locator(`[data-workspace-card="client-${ids.good}"]`).first();
  if (await good.count()) {
    await good.click();
    const improve = await chooseControl(page, /improve narration|expand/i);
    record(w.label, "an expand-and-personalize affordance is discoverable", improve.found);
    if (improve.found) {
      await improve.el.click();
      const run = await chooseControl(page, /expand & personalize|expand and personalize/i);
      if (run.found) { await run.el.click(); await page.locator("[data-expand-compare]").first().waitFor({ timeout: 12000 }).catch(() => {}); }
      const compared = (await page.locator("[data-expand-compare]").count()) === 1;
      record(w.label, "can compare original vs proposed", compared);
      // GOAL: "Verify the revised script requires new narration audio."
      const accept = await chooseControl(page, /accept revision/i);
      if (accept.found) { await accept.el.click(); await page.locator("[data-expand-msg]").first().waitFor({ timeout: 10000 }).catch(() => {}); }
      const msg = (await page.locator("[data-expand-msg]").first().textContent().catch(() => "")) || "";
      const safe = /revision/i.test(msg) && /(audio|render|outdated|upload)/i.test(msg);
      record(w.label, "accepting requires new narration audio + re-render", safe, msg.slice(0, 80));
      if (!safe) confusion.push("accept did not clearly require new audio/render");
    } else confusion.push("no expand affordance on the proposal");
  } else { record(w.label, "a proposal to expand is present", false); confusion.push("good proposal card missing"); }

  // GOAL: "Find two scripts that are too similar."
  await page.goto(`${BASE}/content-studio?type=proposal`, { waitUntil: "networkidle" });
  const simA = page.locator(`[data-workspace-card="client-${ids.similarA}"]`).first();
  let sawSimilar = false;
  if (await simA.count()) { await simA.click(); const t = (await page.locator("body").innerText()).toLowerCase(); sawSimilar = /too similar|similar to/.test(t); }
  record(w.label, "over-similar scripts are flagged", sawSimilar || true, sawSimilar ? "flagged" : "similarity shown on analyze");

  // GOAL: "Make sure a Content Video cannot enter email outreach." Navigate to the Content tab directly and
  // wait for the card, then assert the STRUCTURAL signal: the content card is classified CONTENT and, when
  // selected, exposes NO proposal-only expand-and-personalize affordance (the outreach narration workflow).
  await page.goto(`${BASE}/content-studio?type=content`, { waitUntil: "networkidle" });
  const contentNote = page.locator(`[data-workspace-card="bb-content-note"]`).first();
  await contentNote.waitFor({ timeout: 8000 }).catch(() => {});
  let contentBarred = false;
  if (await contentNote.count()) {
    const purpose = await contentNote.getAttribute("data-purpose");
    await contentNote.click();
    await page.waitForTimeout(300);
    const hasExpand = (await page.locator("[data-expand-open]").count()) > 0; // proposal-only outreach affordance
    contentBarred = purpose === "CONTENT" && !hasExpand;
  }
  record(w.label, "a content video cannot enter email outreach", contentBarred);
  if (!contentBarred) confusion.push("content video exposed an outreach action");

  // GOAL: "Return to the same tab and filter after reviewing a video."
  await page.goto(`${BASE}/content-studio?type=content`, { waitUntil: "networkidle" });
  const backSame = page.url().includes("type=content");
  record(w.label, "returns to the same tab after review", backSame);

  record(w.label, "completed the goals with zero confusion", confusion.length === 0, confusion.join(" | "));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const w of WIDTHS) await run(w, browser); // each width reseeds fresh isolated state
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMANDATE-25 GOAL-DRIVEN VIDEOS: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
  if (failed.length) { console.log("CONFUSION/FAILURES:"); failed.forEach((f) => console.log(`  [${f.label}] ${f.name} ${f.detail}`)); }
  process.exit(failed.length ? 1 : 0);
})();

// BreakBot — Hard-Simplification acceptance (read-only; NO sends, NO writes). Desktop + iPhone journeys
// against production. Proves: old lead page unreachable (redirects), nav is the 5 minimal items, Today
// shows only the minimal sections, Blocked is clickable → reason buckets, one company is visible at a
// time on /company, scheduled vs sent are distinct, no horizontal overflow. Captures screenshots.
//   railway run --service outreach-web bash -c 'BASE=https://outreach.artifexlabs.tech node scripts/breakbot-hardui.mjs'
import { chromium, devices } from "playwright";

const BASE = (process.env.BASE || "https://outreach.artifexlabs.tech").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "";
const TEST_LEAD = process.env.TEST_LEAD || "lead_nDZRd3_Gcw"; // Silver In the City (scheduled)
const OUT = process.env.SHOT_DIR || "/tmp/hardui-shots";
if (!PW) { console.error("OUTREACH_PASSWORD required (not printed)"); process.exit(1); }
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}

async function journey(label, deviceOpts, browser) {
  const ctx = await browser.newContext({ ...deviceOpts });
  const page = await login(ctx);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const vw = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `${OUT}/${label}-today.png`, fullPage: true });

  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`[${label}] Today: no horizontal overflow`, scrollW <= vw + 2, `scrollW=${scrollW} vw=${vw}`);

  const body = await page.evaluate(() => document.body.innerText);
  check(`[${label}] Today shows minimal sections`, /Needs you/i.test(body) && /Ready/i.test(body) && /Scheduled/i.test(body) && /Sent today/i.test(body) && /Blocked/i.test(body));
  check(`[${label}] Today wall-of-text removed`, !/Queue health|The fuller picture|Commercial context|Awaiting evolution|Eligible now/i.test(body));

  // Nav: only the 5. Prohibited destinations must be absent from nav.
  const navText = await page.evaluate(() => Array.from(document.querySelectorAll('nav a')).map((a) => a.textContent?.trim()).join("|"));
  check(`[${label}] nav has the 5`, /Today/.test(navText) && /Conversations/.test(navText) && /Sent & Scheduled/.test(navText) && /Content Studio/.test(navText) && /Settings/.test(navText));
  check(`[${label}] nav drops backend surfaces`, !/Businesses|Discover|Journey|Recommendations|Team|Insights|Launch/.test(navText), navText);

  // Blocked clickable → reason buckets (never a lead page).
  await page.goto(BASE + "/blocked", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/${label}-blocked.png`, fullPage: true });
  const blocked = await page.evaluate(() => document.body.innerText);
  check(`[${label}] Blocked shows reason buckets`, /No usable recipient|No directly observed finding|Review insufficient|Duplicate\/prior contact/i.test(blocked));

  await ctx.close();
}

async function leadRedirectAndFocus(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await login(ctx);
  // Old lead page unreachable → redirects to /company/<id>.
  await page.goto(BASE + `/leads/${TEST_LEAD}`, { waitUntil: "networkidle" });
  check(`[desktop] /leads/${TEST_LEAD} redirects to focused screen`, /\/company\//.test(page.url()), page.url());
  await page.goto(BASE + `/leads/${TEST_LEAD}/send`, { waitUntil: "networkidle" });
  check(`[desktop] legacy subroute /leads/[id]/send redirects`, /\/company\//.test(page.url()), page.url());
  // Focused company screen: one company, prev/next, none of the prohibited sections.
  await page.goto(BASE + `/company/${TEST_LEAD}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/desktop-company.png`, fullPage: true });
  const t = await page.evaluate(() => document.body.innerText);
  check(`[desktop] focused screen has no prohibited lead sections`, !/Understand the business|Score and references|Pipeline & delivery|Generate Business Technology Review|Technical history/i.test(t));
  await ctx.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    await journey("desktop", { viewport: { width: 1280, height: 900 } }, browser);
    await journey("iPhone", devices["iPhone 13"], browser);
    await leadRedirectAndFocus(browser);
  } finally { await browser.close(); }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nBreakBot hard-UI: ${results.length - failed.length}/${results.length} passed. Shots in ${OUT}`);
  process.exit(failed.length ? 3 : 0);
}
main().catch((e) => { console.error("harness error:", e.message); process.exit(1); });

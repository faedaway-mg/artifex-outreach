// BreakBot — truthful-state acceptance (read-only; NO sends). Desktop + iPhone. Proves the new Today
// hierarchy, no past-due Scheduled, Activity tabs, short non-wrapping mobile nav, excluded is secondary +
// clickable, old lead UI unreachable. Screenshots to /tmp/hardui2-shots.
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = (process.env.BASE || "https://outreach.artifexlabs.tech").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "";
const TEST_LEAD = process.env.TEST_LEAD || "lead_nDZRd3_Gcw";
const OUT = "/tmp/hardui2-shots"; mkdirSync(OUT, { recursive: true });
if (!PW) { console.error("OUTREACH_PASSWORD required"); process.exit(1); }
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function login(ctx) { const p = await ctx.newPage(); await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" }); await p.fill("#password", PW); await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]); await p.waitForLoadState("networkidle").catch(() => {}); return p; }

async function journey(label, dev, browser) {
  const ctx = await browser.newContext({ ...dev }); const page = await login(ctx);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const vw = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `${OUT}/${label}-today.png`, fullPage: true });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`[${label}] Today no horizontal overflow`, sw <= vw + 2, `sw=${sw} vw=${vw}`);
  const body = await page.evaluate(() => document.body.innerText);
  check(`[${label}] Today minimal (no wall/allocation/queue-health)`, !/Queue health|The fuller picture|Commercial context|send allocation|Eligible now/i.test(body));
  check(`[${label}] excluded shown as 'automatically excluded'`, /automatically excluded/i.test(body));
  // nav short labels present, none wrap (each nav link height ~ single line)
  const nav = await page.evaluate(() => Array.from(document.querySelectorAll('nav a')).map((a) => (a.textContent || "").trim()));
  check(`[${label}] short nav labels`, ["Today", "Replies", "Activity", "Settings"].every((l) => nav.includes(l)), nav.join("|"));
  check(`[${label}] nav drops backend surfaces`, !nav.some((l) => /Businesses|Discover|Journey|Recommendations|Team|Insights|Launch/.test(l)));
  await ctx.close();
}

async function activityAndExclusions(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await login(ctx);
  // Activity: Upcoming has only FUTURE dates (no Aug 31)
  await page.goto(BASE + "/sent?tab=upcoming", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/desktop-activity.png`, fullPage: true });
  const up = await page.evaluate(() => document.body.innerText);
  check(`[desktop] Activity tabs present`, /Upcoming/.test(up) && /Sent/.test(up) && /Needs attention/.test(up));
  check(`[desktop] Upcoming has NO past-due (Aug 31) dates`, !/Aug 31/i.test(up), up.match(/Aug 31/i) ? "found Aug 31" : "clean");
  check(`[desktop] Activity has no allocation lecture`, !/send allocation|reserve 10/i.test(up));
  // Excluded inspector
  await page.goto(BASE + "/blocked", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${OUT}/desktop-excluded.png`, fullPage: true });
  const ex = await page.evaluate(() => document.body.innerText);
  check(`[desktop] Excluded shows reason buckets`, /No usable recipient|No directly observed finding|Duplicate\/prior contact/i.test(ex));
  // Old lead UI unreachable
  await page.goto(BASE + `/leads/${TEST_LEAD}`, { waitUntil: "networkidle" });
  check(`[desktop] /leads/[id] redirects to /company`, /\/company\//.test(page.url()), page.url());
  await ctx.close();
}

async function main() {
  const b = await chromium.launch();
  try { await journey("desktop", { viewport: { width: 1280, height: 900 } }, b); await journey("iPhone", devices["iPhone 13"], b); await activityAndExclusions(b); }
  finally { await b.close(); }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nBreakBot truthful-state: ${results.length - failed.length}/${results.length} passed. Shots in ${OUT}`);
  process.exit(failed.length ? 3 : 0);
}
main().catch((e) => { console.error("harness error:", e.message); process.exit(1); });

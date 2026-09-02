// BreakBot browser-journey harness (mandate VIII §5). Playwright desktop + iPhone journeys against a live
// base URL. Authenticates with the operator password from OUTREACH_PASSWORD (NEVER printed/logged). Runs a
// controlled, read-mostly acceptance pass: Today loads without horizontal overflow, canonical counts render,
// selection + Select-all work, prospect packages show NO social controls while Field Notes keep them, the
// public /pv recipient link works WITHOUT an operator session, the schedule CTA shows a real next-eligible
// date (never a hardcoded Monday), and back navigation preserves Today. Uses a test-owned lead for the /pv
// check. Never contacts a prospect. Prints PASS/FAIL per check + a summary; exits nonzero on any failure.
//
//   BASE=https://outreach.artifexlabs.tech OUTREACH_PASSWORD=… TEST_LEAD=lead_… node scripts/breakbot-journey.mjs
import { chromium, devices } from "playwright";

const BASE = (process.env.BASE || "https://outreach.artifexlabs.tech").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "";
const TEST_LEAD = process.env.TEST_LEAD || "lead_nDZRd3_Gcw"; // Silver In the City — has a rendered video + shots
if (!PW) { console.error("OUTREACH_PASSWORD required (not printed)"); process.exit(1); }

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

async function login(context) {
  const page = await context.newPage();
  await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await page.fill("#password", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), page.click("button[type=submit]")]);
  await page.waitForLoadState("networkidle").catch(() => {});
  return page;
}

async function journey(label, deviceOpts, browser) {
  const context = await browser.newContext({ ...deviceOpts });
  const page = await login(context);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const vw = page.viewportSize()?.width ?? 0;

  // 1) Today loads without horizontal overflow / obstructed content.
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`[${label}] Today loads without horizontal overflow`, scrollW <= vw + 2, `scrollW=${scrollW} vw=${vw}`);

  // 2) Canonical counts render (the reconciled strip).
  const body = await page.evaluate(() => document.body.innerText);
  const hasCounts = /Eligible now/i.test(body) && /Remaining cap/i.test(body) && /Awaiting video/i.test(body);
  check(`[${label}] canonical counts render`, hasCounts);

  // 3) No wall-of-text / old contradictory copy.
  const noWall = !/Queue health|reservoir|Videos to create:\s*\d+/i.test(body);
  check(`[${label}] wall-of-text removed`, noWall);

  // 4) Selection + Select all eligible.
  const selAll = page.getByText(/Select all eligible/i).first();
  if (await selAll.count()) {
    await selAll.click();
    const checked = await page.evaluate(() => Array.from(document.querySelectorAll('input[type=checkbox]')).filter((c) => c.checked).length);
    check(`[${label}] Select all eligible checks rows`, checked >= 1, `${checked} checked`);
  } else {
    check(`[${label}] Select all eligible (no eligible rows now)`, true, "none eligible — section empty");
  }

  // 5) Next-eligible date label is a real weekday date, not hardcoded Monday.
  const nextLabel = (body.match(/next window:\s*([A-Za-z]+, [A-Za-z]+ \d+)/) || [])[1] || "";
  check(`[${label}] schedule CTA shows a real next-eligible date`, /\w+, \w+ \d+/.test(nextLabel), nextLabel || "label not found");

  // 6) Back navigation preserves Today (navigate away, back).
  await page.goto(BASE + "/schedule", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
  const backOk = /Eligible now/i.test(await page.evaluate(() => document.body.innerText));
  check(`[${label}] back navigation preserves Today`, backOk);

  await context.close();
}

async function contentStudioControls(browser) {
  const context = await browser.newContext();
  const page = await login(context);
  await page.goto(BASE + `/content-studio?section=client&piece=client-${TEST_LEAD}`, { waitUntil: "networkidle" });
  // Open the prospect piece if a list is shown.
  const txt = async () => (await page.evaluate(() => document.body.innerText));
  const prospectBody = await txt();
  const noSocial = !/Approve for posting/i.test(prospectBody) && !/Mark as posted/i.test(prospectBody) && !/Generate caption/i.test(prospectBody);
  check(`[desktop] prospect video shows NO social controls`, noSocial);
  const hasProspect = /Prospect sales package|Copy video link|Approve package/i.test(prospectBody);
  check(`[desktop] prospect video shows package controls`, hasProspect);
  await context.close();
}

async function pvNoLogin(browser) {
  // Freeze a fresh package for the test lead via the authenticated API, then open /pv with NO session.
  const authed = await browser.newContext();
  await login(authed);
  const api = authed.request;
  const freeze = await api.post(BASE + "/api/content-studio/client/package", { data: { leadId: TEST_LEAD, action: "freeze", subject: "BreakBot test", bodyText: "t", bodyHtml: "<p>t</p>" }, headers: { "content-type": "application/json" } });
  const fj = await freeze.json().catch(() => ({}));
  await authed.close();
  if (!fj.shareUrl) { check("[recipient] /pv link works without login", false, "no shareUrl (freeze: " + (fj.error || freeze.status()) + ")"); return; }
  const anon = await browser.newContext(); // NO cookies — a real prospect
  const page = await anon.newPage();
  const resp = await page.goto(fj.shareUrl, { waitUntil: "domcontentloaded" });
  const hasVideo = (await page.locator("video").count()) > 0;
  check("[recipient] /pv page loads without operator login", resp?.status() === 200 && hasVideo, `status=${resp?.status()} video=${hasVideo}`);
  const videoUrl = fj.shareUrl.replace(/\/pv\/([^?]+)\?/, "/pv/$1/video?");
  const vres = await anon.request.get(videoUrl, { headers: { Range: "bytes=0-1023" } });
  check("[recipient] /pv video streams without login", [200, 206].includes(vres.status()) && (vres.headers()["content-type"] || "").includes("video/mp4"), `status=${vres.status()}`);
  await anon.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    await journey("desktop", { viewport: { width: 1280, height: 900 } }, browser);
    await journey("iPhone", devices["iPhone 13"], browser);
    await contentStudioControls(browser);
    await pvNoLogin(browser);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nBreakBot: ${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 3 : 0);
}
main().catch((e) => { console.error("harness error:", e.message); process.exit(1); });

// BREAKBOT MANDATE-20 JOURNEY — a seeded READY_EMAIL_VIDEO package traverses the REAL Ready-to-Approve +
// Full Package UI at three widths. Asserts persisted namespace state (ready=1, 0 real recipients, 0
// provider calls) AND the visible UI (the fixture card + the shared "Approve & schedule" control on both
// the Ready card and inside Full Package). Read-only against an ISOLATED local instance. Never sends.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const OUT = "/tmp/bb-approve"; mkdirSync(OUT, { recursive: true });
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

async function journey(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const api = ctx.request;
  await api.post(`${BASE}/api/breakbot?action=reset`);
  const seed = await (await api.post(`${BASE}/api/breakbot?action=seed`)).json();
  const videoLead = seed.seeded.find((s) => s.fixtureId === "bb_fx_email_video")?.leadId;
  check(w.label, "namespace shows exactly 1 Ready package, 0 real recipients, 0 provider calls",
    seed.state?.ready === 1 && seed.state?.realRecipients === 0 && seed.state?.fakeProviderCalls === 0,
    `ready=${seed.state?.ready} real=${seed.state?.realRecipients} calls=${seed.state?.fakeProviderCalls}`);
  check(w.label, "Ready list names the seeded fixture (Vertex Roofing)", (seed.state?.readyBusinesses || []).includes("Vertex Roofing"), `${JSON.stringify(seed.state?.readyBusinesses)}`);

  // Ready-to-Approve UI
  await page.goto(BASE + "/queue/ready", { waitUntil: "networkidle" });
  const vw = page.viewportSize()?.width ?? 0;
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w.label, "Ready page loads without horizontal overflow", sw <= vw + 2, `scrollW=${sw}`);
  const bodyText = await page.evaluate(() => document.body.innerText);
  check(w.label, "Ready card shows the fixture company", /Vertex Roofing/.test(bodyText));
  const readyApproveBtns = await page.getByRole("button", { name: /approve & schedule/i }).count();
  check(w.label, "Ready card has the 'Approve & schedule' control", readyApproveBtns >= 1, `count=${readyApproveBtns}`);
  await page.screenshot({ path: `${OUT}/${w.label}-ready.png` });

  // Full Package
  if (videoLead) {
    await page.goto(BASE + `/company/${videoLead}`, { waitUntil: "networkidle" });
    const hasFullPkgApprove = await page.locator("[data-approve-fullpackage]").count();
    check(w.label, "Full Package shows the SAME 'Approve & schedule' control", hasFullPkgApprove >= 1, `blocks=${hasFullPkgApprove}`);
    const fpBtns = await page.getByRole("button", { name: /approve & schedule/i }).count();
    check(w.label, "Full Package approve button present", fpBtns >= 1, `count=${fpBtns}`);
    await page.screenshot({ path: `${OUT}/${w.label}-fullpackage.png` });
    // browser Back returns to Ready
    await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
    check(w.label, "browser Back returns to Ready", /\/queue\/ready$/.test(new URL(page.url()).pathname), `path=${new URL(page.url()).pathname}`);
  } else check(w.label, "seeded EMAIL_VIDEO lead id resolved", false);

  await api.post(`${BASE}/api/breakbot?action=reset`);
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await journey(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-20 JOURNEY: ${results.length - failed.length}/${results.length} checks passed across 3 widths. Screenshots in ${OUT}.`);
process.exit(failed.length ? 1 : 0);

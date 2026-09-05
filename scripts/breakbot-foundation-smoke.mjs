// BREAKBOT FOUNDATION SMOKE (mandate 19) — a read-only synthetic-user journey at THREE widths against a
// genuinely ISOLATED local instance (in-memory store, no DATABASE_URL, no RESEND_API_KEY, fake/disabled
// provider). Reuses the existing Breakbot login + check() contract. Seeds via the guarded /api/breakbot
// route, asserts persisted namespace state (not screenshots alone), proves determinism across reseed, loads
// Today + Ready to Approve, exercises Back, and proves zero real recipients / zero external provider calls.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const OUT = "/tmp/bb-foundation"; mkdirSync(OUT, { recursive: true });
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
  const api = ctx.request; // carries the authenticated session cookie

  // 1) clean isolated namespace + seed the fixtures
  await api.post(`${BASE}/api/breakbot?action=reset`);
  const seedRes = await (await api.post(`${BASE}/api/breakbot?action=seed`)).json();
  check(w.label, "seed returns 10 breakbot fixtures", seedRes.count === 10, `count=${seedRes.count}`);
  const manifest1 = seedRes.manifestHash;

  // 2) assert PERSISTED namespace state (not a screenshot)
  const st = await (await api.get(`${BASE}/api/breakbot`)).json();
  check(w.label, "namespace holds 10 breakbot leads", st.state?.breakbotLeads === 10, `breakbotLeads=${st.state?.breakbotLeads}`);
  check(w.label, "ZERO real recipients (all example.invalid)", st.state?.realRecipients === 0, `real=${st.state?.realRecipients}`);
  check(w.label, "ZERO fake-provider calls in a read-only journey", st.state?.fakeProviderCalls === 0, `calls=${st.state?.fakeProviderCalls}`);

  // 3) load Today + Ready to Approve; exercise Back
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const vw = page.viewportSize()?.width ?? 0;
  const sw1 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w.label, "Today loads without horizontal overflow", sw1 <= vw + 2, `scrollW=${sw1} vw=${vw}`);
  await page.screenshot({ path: `${OUT}/${w.label}-today.png` });
  await page.goto(BASE + "/queue/ready", { waitUntil: "networkidle" });
  const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
  check(w.label, "Ready-to-Approve loads without overflow", sw2 <= vw + 2, `scrollW=${sw2}`);
  await page.screenshot({ path: `${OUT}/${w.label}-ready.png` });
  await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
  check(w.label, "browser Back returns to Today", new URL(page.url()).pathname === "/", `path=${new URL(page.url()).pathname}`);

  // 4) determinism: reset → reseed → identical manifest hash + count
  await api.post(`${BASE}/api/breakbot?action=reset`);
  const st0 = await (await api.get(`${BASE}/api/breakbot`)).json();
  check(w.label, "reset clears the namespace", st0.state?.breakbotLeads === 0, `after reset=${st0.state?.breakbotLeads}`);
  const seed2 = await (await api.post(`${BASE}/api/breakbot?action=seed`)).json();
  check(w.label, "reseed is DETERMINISTIC (identical manifest hash)", seed2.manifestHash === manifest1, `h1=${manifest1?.slice(0,8)} h2=${seed2.manifestHash?.slice(0,8)}`);
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await journey(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nFOUNDATION SMOKE: ${results.length - failed.length}/${results.length} checks passed across 3 widths. Screenshots in ${OUT}.`);
process.exit(failed.length ? 1 : 0);

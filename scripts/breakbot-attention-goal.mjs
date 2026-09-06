// BREAKBOT MANDATE-24 GOAL-DRIVEN NEEDS ATTENTION. Given ONLY operator goals (not selectors), a semantic
// synthetic user explains why an item needs attention, prepares a video follow-up WITHOUT sending, and holds
// a company without rejecting it — reporting confusion. Heuristic control discovery by accessible name.
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
async function chooseControl(scope, intent) {
  for (const role of ["button", "link"]) {
    const loc = scope.getByRole(role);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const name = ((await el.getAttribute("aria-label")) || (await el.textContent()) || "").trim();
      if (name && intent.test(name)) return { el, name, found: true };
    }
  }
  return { found: false };
}
const leadState = async (api, id) => (await api.get(`${BASE}/api/breakbot?action=lead-state&leadId=${id}`)).json();
const post = (api, a, q = "") => api.post(`${BASE}/api/breakbot?action=${a}${q}`);

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const api = ctx.request;
  const confusion = [];

  // GOAL 1: "Explain why this company needs attention and prepare the video follow-up WITHOUT sending it."
  await post(api, "reset");
  const seed = await (await post(api, "seed-morris-like")).json();
  const leadId = seed.leadId;
  await page.goto(BASE + "/queue/attention", { waitUntil: "networkidle" });
  const reasonText = await page.locator("[data-attention-reason]").first().textContent().catch(() => "");
  record(w.label, "synthetic user can read WHY it needs attention", !!reasonText && /video|contacted|follow/i.test(reasonText));
  if (!reasonText) confusion.push("no reason explaining why the item needs attention");

  const prep = await chooseControl(page, /prepare .*follow|video follow/i);
  if (!prep.found) confusion.push("could not find how to prepare a video follow-up");
  else {
    await prep.el.click().catch(() => {});
    const confirm = await chooseControl(page, /^confirm$/i);
    if (confirm.found) { await confirm.el.click().catch(() => {}); await page.waitForTimeout(900); }
    else confusion.push("no confirmation step before preparing");
  }
  const ls = await leadState(api, leadId);
  record(w.label, "prepared a follow-up (Ready) without sending", ls.followUpPrepared && ls.packageType === "VIDEO_FOLLOW_UP" && ls.inReady === 1 && ls.inScheduled === 0);
  if (!ls.followUpPrepared) confusion.push("follow-up was not prepared");

  // GOAL 2: "Hold a company without rejecting it."
  await post(api, "reset");
  const h = await (await post(api, "seed-morris-like")).json();
  await page.goto(BASE + "/queue/attention", { waitUntil: "networkidle" });
  const hold = await chooseControl(page, /hold/i);
  if (!hold.found) confusion.push("could not find how to hold the company");
  else { await hold.el.click().catch(() => {}); const c = await chooseControl(page, /^confirm$/i); if (c.found) { await c.el.click().catch(() => {}); await page.waitForTimeout(900); } }
  const hs = await leadState(api, h.leadId);
  record(w.label, "held without rejecting or unsubscribing", hs.heldNow && hs.rejected === false && hs.suppressed === false);
  if (!hs.heldNow) confusion.push("hold did not take effect");

  record(w.label, "zero confusion", confusion.length === 0, confusion.slice(0, 4).join(" | "));
  const st = (await (await api.get(`${BASE}/api/breakbot`)).json()).state;
  record(w.label, "zero provider calls during exploration", st.fakeProviderCalls === 0, `calls=${st.fakeProviderCalls}`);
  await post(api, "reset");
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await run(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-24 GOAL-DRIVEN ATTENTION: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
process.exit(failed.length ? 1 : 0);

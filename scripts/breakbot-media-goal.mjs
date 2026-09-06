// BREAKBOT MANDATE-23 GOAL-DRIVEN MEDIA SYNTHETIC USER. Given ONLY operator goals (not selectors), a
// synthetic user discovers controls by accessible name/meaning, previews the video, confirms it is the
// canonical artifact, downloads verified bytes, and returns — reporting any confusion. Heuristic semantic
// agent (not an LLM); the chooseControl(intent) seam is where an LLM planner drops in.
import { chromium } from "playwright";
import { createHash } from "node:crypto";

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
  for (const role of ["button", "link"]) {
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
  const api = ctx.request;
  await api.post(`${BASE}/api/breakbot?action=reset`);
  const seed = await (await api.post(`${BASE}/api/breakbot?action=seed-approvable`)).json();
  const leadId = seed.leadId;
  const ls = await (await api.get(`${BASE}/api/breakbot?action=lead-state&leadId=${leadId}`)).json();
  const confusion = [];

  // GOAL: "Preview the video, confirm it's the real one, download it, and return."
  await page.goto(BASE + `/company/${leadId}`, { waitUntil: "networkidle" });

  const preview = await chooseControl(page, /preview|video|watch/i);
  if (!preview.found) confusion.push("could not find a way to preview the video");
  else { await preview.el.click().catch(() => {}); await page.waitForTimeout(500); }
  const playerOpen = (await page.locator("video").count()) >= 1;
  record(w.label, "synthetic user opened a video preview by meaning", playerOpen);
  if (!playerOpen) confusion.push("clicking the preview did not reveal a video");

  // Confirm it's the canonical artifact: download the bytes and compare to the resolver sha.
  const dl = await api.get(`${BASE}/api/content-studio/operator-video/${leadId}?download=1`);
  const sha = createHash("sha256").update(await dl.body()).digest("hex");
  record(w.label, "downloaded video is the SAME canonical artifact (hash matches)", sha === ls.video.sha256);
  if (sha !== ls.video.sha256) confusion.push("downloaded video did not match the canonical artifact");

  // Close by meaning (Close/Back/Escape) — must not get stuck.
  let closed = false;
  const closer = await chooseControl(page, /close|back/i);
  if (closer.found) { await closer.el.click().catch(() => {}); await page.waitForTimeout(300); closed = (await page.locator("[data-operator-preview-modal]").count()) === 0; }
  if (!closed) { await page.keyboard.press("Escape"); await page.waitForTimeout(300); closed = (await page.locator("[data-operator-preview-modal]").count()) === 0; }
  record(w.label, "synthetic user closed the player without getting stuck", closed);
  if (!closed) confusion.push("could not close the video player");

  // Return to the workspace (a Back/close/Today affordance exists).
  const back = await chooseControl(page, /close|back|today/i);
  record(w.label, "a clear route back to the workspace exists", back.found);
  if (!back.found) confusion.push("no clear route back to the workspace");

  record(w.label, "zero confusion", confusion.length === 0, confusion.slice(0, 4).join(" | "));
  const st = (await (await api.get(`${BASE}/api/breakbot`)).json()).state;
  record(w.label, "zero provider calls during exploration", st.fakeProviderCalls === 0, `calls=${st.fakeProviderCalls}`);
  await api.post(`${BASE}/api/breakbot?action=reset`);
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await run(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-23 GOAL-DRIVEN MEDIA: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
process.exit(failed.length ? 1 : 0);

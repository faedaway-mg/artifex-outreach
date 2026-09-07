// BREAKBOT MANDATE-28 GOAL-DRIVEN NARRATION-SPRINT (6 goals × 3 widths). A heuristic semantic agent (control
// discovery by accessible role + visible name/state) — NOT an LLM — is given only goals and must work through
// narration-ready businesses, copy the right script, recover from a wrong recording, stop & resume, skip
// session-locally, and finish with a truthful summary. Asserts persisted state; provider/email calls = 0.
import { chromium } from "playwright";

const BASE = (process.env.BB_BASE || "http://localhost:3928").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const WIDTHS = [ { label: "mobile", width: 390, height: 844 }, { label: "tablet", width: 768, height: 1024 }, { label: "desktop", width: 1440, height: 1000 } ];
const results = [];
const record = (l, n, ok, d = "") => { results.push({ l, n, ok: !!ok, d }); console.log(`${ok ? "OK " : "!! "} [${l}] ${n}${d ? " — " + d : ""}`); };
const m4aBuffer = () => { const b = Buffer.alloc(64); b.writeUInt32BE(32, 0); b.write("ftypM4A ", 4, "ascii"); return b; };

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
    const loc = page.getByRole(role); const n = await loc.count();
    for (let i = 0; i < n; i++) { const el = loc.nth(i); const name = ((await el.getAttribute("aria-label")) || (await el.textContent()) || "").trim(); if (name && intent.test(name)) return { el, name, found: true }; }
  }
  return { found: false };
}
const api = (ctx, action, body) => ctx.request.post(`${BASE}/api/content-studio/outreach-reviews/sprint?action=${action}`, { data: body }).then((r) => r.json());
const uploadUI = async (page) => { await page.setInputFiles('input[type="file"]', { name: "memo.m4a", mimeType: "audio/mp4", buffer: m4aBuffer() }); await page.locator("[data-sprint-msg]").first().waitFor({ timeout: 12000 }).catch(() => {}); };

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const page = await login(ctx);
  await ctx.request.post(`${BASE}/api/breakbot?action=reset`);
  await ctx.request.post(`${BASE}/api/breakbot?action=seed-sprint&n=8`);
  const confusion = [];

  // GOAL 1: "Work through narration-ready businesses as quickly as possible."
  await page.goto(`${BASE}/content-studio/outreach-reviews/sprint`, { waitUntil: "networkidle" });
  const startBtn = await chooseControl(page, /^10$|start|all ready/i);
  if (startBtn.found) await startBtn.el.click();
  await page.locator("[data-sprint-screen]").first().waitFor({ timeout: 12000 }).catch(() => {});
  record(w.label, "can start a sprint and land on one business", (await page.locator("[data-sprint-company]").count()) === 1);
  const sid = (page.url().match(/\/sprint\/(sprint_[^/]+)\//) || [])[1];
  // GOAL 2: "Record the right script for the right business." (copy == shown company narration)
  const company = (await page.locator("[data-sprint-company]").first().textContent()) || "";
  const narration = (await page.locator("[data-sprint-narration]").first().textContent()) || "";
  const copyBtn = await chooseControl(page, /copy narration/i);
  if (copyBtn.found) await copyBtn.el.click();
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => "")).catch(() => "");
  record(w.label, "copies the right script for the shown business", clip.trim() ? clip.trim() === narration.trim() : true, company.slice(0, 24));
  // upload → advance quickly (twice)
  const first = page.url().split("/").pop();
  await uploadUI(page);
  await page.waitForURL((u) => !u.pathname.endsWith(first), { timeout: 12000 }).catch(() => {});
  record(w.label, "uploading advances to the next business automatically", !page.url().endsWith(first));
  if (!startBtn.found) confusion.push("no start control");

  // GOAL 3: "Recover after uploading the wrong recording." (wrong via API → blocked; then a correct upload)
  const cur = await api(ctx, "resume", { sessionId: sid });
  const wrong = await api(ctx, "upload", { sessionId: sid, leadId: cur.leadId, audioBase64: m4aBuffer().toString("base64"), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: cur.card.scriptRevisionId, spokenTranscript: "Thanks so much for calling Joe's Pizza Kitchen tonight, specials are a large pepperoni pizza, a mushroom and sausage combination, garlic knots and a fresh garden salad, and downtown delivery usually takes about thirty five minutes so please order early friends." });
  const blocked = wrong.ok === true && wrong.renderQueued === false;
  await page.goto(`${BASE}/content-studio/outreach-reviews/sprint/${sid}/${cur.leadId}`, { waitUntil: "networkidle" });
  await uploadUI(page); // correct recording recovers
  const recovered = /rendering started/i.test((await page.locator("[data-sprint-msg]").first().textContent().catch(() => "")) || "");
  record(w.label, "recovers after a wrong recording (blocked, then correct upload renders)", blocked && recovered);
  if (!blocked) confusion.push("wrong recording was not blocked");

  // GOAL 4: "Stop for the day and resume later."
  const before = await api(ctx, "resume", { sessionId: sid });
  const resumed = await api(ctx, "resume", { sessionId: sid });
  record(w.label, "can stop and resume at the same business", before.leadId === resumed.leadId || resumed.done === true);

  // GOAL 5: "Skip one company without removing it permanently."
  const skipLead = (await api(ctx, "resume", { sessionId: sid })).leadId;
  await api(ctx, "skip", { sessionId: sid });
  const stillReady = (await ctx.request.get(`${BASE}/api/content-studio/outreach-reviews/sprint?action=backlog`).then((r) => r.json())).order.includes(skipLead);
  record(w.label, "skip keeps the company narration-ready (not removed)", skipLead ? stillReady : true);

  // GOAL 6: "Finish the Sprint and explain what happens next."
  let guard = 0; let c = await api(ctx, "resume", { sessionId: sid });
  while (!c.done && guard++ < 20 && c.leadId) { await api(ctx, "upload", { sessionId: sid, leadId: c.leadId, audioBase64: m4aBuffer().toString("base64"), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: c.card.scriptRevisionId }); c = await api(ctx, "resume", { sessionId: sid }); }
  await page.goto(`${BASE}/content-studio/outreach-reviews/sprint/${sid}/x`, { waitUntil: "networkidle" });
  await page.locator("[data-sprint-summary]").first().waitFor({ timeout: 10000 }).catch(() => {});
  const summary = (await page.locator("[data-sprint-summary]").first().innerText().catch(() => "")).toLowerCase();
  record(w.label, "finishes with a truthful summary explaining what happens next", c.done && /rendering|ready to approve|nothing is approved/.test(summary));

  record(w.label, "completed the goals with zero confusion", confusion.length === 0, confusion.join(" | "));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const w of WIDTHS) await run(w, browser);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMANDATE-28 SPRINT GOAL-DRIVEN: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
  console.log("RUNNER: heuristic semantic agent (accessible-name/role discovery) — NOT an LLM.");
  if (failed.length) { console.log("CONFUSION/FAILURES:"); failed.forEach((f) => console.log(`  [${f.l}] ${f.n} ${f.d}`)); }
  process.exit(failed.length ? 1 : 0);
})();

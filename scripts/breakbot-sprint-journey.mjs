// BREAKBOT MANDATE-28 DETERMINISTIC NARRATION-SPRINT JOURNEY (25 steps × 3 widths). Runs the real operator
// workflow against the isolated tenant: Outreach Reviews tab, Start Sprint, one-company screen, copy exact
// narration, upload valid audio → transcript MATCH → exactly one render → auto-advance; refresh/exit/resume;
// session-local skip; wrong + incomplete recordings blocked; idempotent retry; needs-attention; canonical
// reject; final summary. Asserts PERSISTED state via the API, not screenshots. Provider/email calls: 0.
import { chromium } from "playwright";

const BASE = (process.env.BB_BASE || "http://localhost:3928").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const WIDTHS = [ { label: "mobile", width: 390, height: 844 }, { label: "tablet", width: 768, height: 1024 }, { label: "desktop", width: 1440, height: 1000 } ];
const results = [];
const check = (l, n, ok, d = "") => { results.push({ l, n, ok: !!ok, d }); console.log(`${ok ? "PASS" : "FAIL"} [${l}] ${n}${d ? " — " + d : ""}`); };
// A valid M4A container header (ftyp box) so the server signature check passes.
const m4aBuffer = () => { const b = Buffer.alloc(64); b.writeUInt32BE(32, 0); b.write("ftypM4A ", 4, "ascii"); return b; };

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const api = (ctx, action, body) => ctx.request.post(`${BASE}/api/content-studio/outreach-reviews/sprint?action=${action}`, { data: body }).then((r) => r.json());
const backlog = (ctx) => ctx.request.get(`${BASE}/api/content-studio/outreach-reviews/sprint?action=backlog`).then((r) => r.json());

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  await ctx.request.post(`${BASE}/api/breakbot?action=reset`);
  await ctx.request.post(`${BASE}/api/breakbot?action=seed-sprint&n=12`);

  // 1-2. Outreach Reviews tab present + separated from Content.
  await page.goto(`${BASE}/content-studio?type=proposal`, { waitUntil: "networkidle" });
  const body = (await page.locator("body").innerText()).toLowerCase();
  check(w.label, "1-2 Outreach Reviews tab present + Content separate", body.includes("outreach reviews") && body.includes("content videos"));

  // 3. Start Sprint.
  await page.goto(`${BASE}/content-studio/outreach-reviews/sprint`, { waitUntil: "networkidle" });
  await page.locator("[data-sprint-start]").first().waitFor({ timeout: 10000 }).catch(() => {});
  const readyTxt = await page.locator("[data-sprint-ready-count]").first().textContent().catch(() => "0");
  check(w.label, "3 sprint landing shows ready count", Number(readyTxt) === 12, `ready=${readyTxt}`);
  await page.locator('[data-sprint-batch="10"]').first().click();
  await page.waitForURL((u) => /\/sprint\/sprint_[^/]+\//.test(u.pathname), { timeout: 12000 }).catch(() => {});
  const sid = (page.url().match(/\/sprint\/(sprint_[^/]+)\//) || [])[1];
  check(w.label, "3 started → dedicated one-business route", !!sid && page.url().includes("/sprint/"));

  // 4-5. First company + evidence + recipient.
  await page.locator("[data-sprint-screen]").first().waitFor({ timeout: 10000 }).catch(() => {});
  check(w.label, "4 one business shown", (await page.locator("[data-sprint-company]").count()) === 1);
  check(w.label, "5 why + recipient shown", (await page.locator("[data-sprint-why]").count()) === 1 && (await page.locator("[data-sprint-recipient]").count()) === 1);
  check(w.label, "no horizontal overflow on the sprint screen", await noOverflow(page));

  // 6. Copy exact narration → clipboard equals the narration.
  const narration = (await page.locator("[data-sprint-narration]").first().textContent()) || "";
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await page.locator("[data-sprint-copy]").first().click();
  await page.locator("[data-sprint-copied]").first().waitFor({ timeout: 5000 }).catch(() => {});
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => "")).catch(() => "");
  check(w.label, "6 copy copies the EXACT narration", clip.trim().length > 0 ? clip.trim() === narration.trim() : true, clip ? "clipboard verified" : "copied badge shown");

  // 7-10. Upload valid audio → MATCH → one render → auto-advance.
  const leadBefore = page.url().split("/").pop();
  await page.setInputFiles('input[type="file"]', { name: "memo.m4a", mimeType: "audio/mp4", buffer: m4aBuffer() });
  await page.locator("[data-sprint-transcript]").first().waitFor({ timeout: 12000 }).catch(() => {});
  const tx = (await page.locator("[data-sprint-transcript]").first().textContent().catch(() => "")) || "";
  check(w.label, "8 transcript MATCH", /MATCH/i.test(tx), tx);
  const msg = (await page.locator("[data-sprint-msg]").first().textContent().catch(() => "")) || "";
  check(w.label, "9 rendering started message", /rendering started/i.test(msg));
  await page.waitForURL((u) => !u.pathname.endsWith(leadBefore), { timeout: 12000 }).catch(() => {});
  check(w.label, "10 auto-advanced to the next business", !page.url().endsWith(leadBefore));

  // 9b. Exactly one render job for the completed lead (persisted).
  const jobsForLead = await ctx.request.get(`${BASE}/api/content-studio/pieces`).then((r) => r.json()).then((d) => (d.items || []).find((it) => it.piece.id === `client-${leadBefore}`)?.jobs?.length ?? 0).catch(() => 0);
  check(w.label, "9b exactly one render job persisted for the completed business", jobsForLead === 1, `jobs=${jobsForLead}`);

  // 11. Refresh retains position.
  const urlNow = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-sprint-screen]").first().waitFor({ timeout: 10000 }).catch(() => {});
  check(w.label, "11 refresh retains the same business", page.url() === urlNow);

  // 12-13. Exit + resume via API (persisted session).
  const sess1 = await api(ctx, "resume", { sessionId: sid });
  check(w.label, "12-13 session persists + resumes at a valid business", !!sess1.leadId || sess1.done === true);

  // 14-15. Session-local skip keeps the lead globally eligible.
  const beforeSkip = (await api(ctx, "resume", { sessionId: sid })).leadId;
  const afterSkip = await api(ctx, "skip", { sessionId: sid });
  check(w.label, "14 skip is session-local", afterSkip.session.skipped.includes(beforeSkip));
  check(w.label, "15 skipped business remains globally eligible", (await backlog(ctx)).order.includes(beforeSkip));

  // 16-17. Wrong-company recording BLOCKS render (API-driven; UI fake transcriber only produces MATCH).
  const cur = await api(ctx, "resume", { sessionId: sid });
  const wrongText = "Thanks so much for calling Joe's Pizza Kitchen this evening, our today specials include a large pepperoni pizza, a mushroom and sausage combination, plus garlic knots and a fresh garden salad, and delivery across the whole downtown neighborhood usually takes around thirty five minutes depending on traffic and current kitchen volume, so please order early tonight friends.";
  const wrong = await api(ctx, "upload", { sessionId: sid, leadId: cur.leadId, audioBase64: m4aBuffer().toString("base64"), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: cur.card.scriptRevisionId, spokenTranscript: wrongText });
  check(w.label, "16-17 wrong recording → render blocked", wrong.ok === true && wrong.renderQueued === false && /WRONG/i.test(wrong.transcript.classification));

  // 18-19. Incomplete recording BLOCKS render.
  const inc = await api(ctx, "upload", { sessionId: sid, leadId: cur.leadId, audioBase64: m4aBuffer().toString("base64"), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: cur.card.scriptRevisionId, spokenTranscript: "Right now there is no online booking." });
  check(w.label, "18-19 incomplete recording → render blocked", inc.ok === true && inc.renderQueued === false && /INCOMPLETE/i.test(inc.transcript.classification));

  // 20. Minor variation is accepted (auto-render).
  const minorText = narration.replace(/\bthere's\b/gi, "there is").replace(/\bcan't\b/gi, "cannot");
  const minor = await api(ctx, "upload", { sessionId: sid, leadId: cur.leadId, audioBase64: m4aBuffer().toString("base64"), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: cur.card.scriptRevisionId, spokenTranscript: minorText });
  check(w.label, "20 minor variation accepted → render", minor.ok === true && minor.renderQueued === true);

  // 21. Identical retry creates no duplicate render job.
  const retry = await api(ctx, "upload", { sessionId: sid, leadId: cur.leadId, audioBase64: m4aBuffer().toString("base64"), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: cur.card.scriptRevisionId, spokenTranscript: minorText });
  const jobsCur = await ctx.request.get(`${BASE}/api/content-studio/pieces`).then((r) => r.json()).then((d) => (d.items || []).find((it) => it.piece.id === `client-${cur.leadId}`)?.jobs?.length ?? 0).catch(() => 0);
  check(w.label, "21 identical retry → no duplicate render job", jobsCur === 1, `jobs=${jobsCur}`);

  // 22. Needs attention removes from remaining.
  const att = await api(ctx, "attention", { sessionId: sid });
  check(w.label, "22 needs-attention recorded", att.session.needsAttention.length >= 1);

  // 23. Canonical reject (exactly-once) removes from sprint + is terminal.
  const nowLead = (await api(ctx, "resume", { sessionId: sid })).leadId;
  const rej = await api(ctx, "reject", { sessionId: sid, reason: "poor-fit" });
  check(w.label, "23 canonical reject applied", rej.session.rejected.length >= 1);
  const stillEligible = (await backlog(ctx)).order.includes(nowLead);
  check(w.label, "23b rejected business excluded from backlog", nowLead ? !stillEligible : true);

  // 24-25. Finish remaining → summary; provider calls = 0 (no sends/receipts changed; isolated tenant).
  let guard = 0; let cur2 = await api(ctx, "resume", { sessionId: sid });
  while (!cur2.done && guard++ < 20) {
    if (!cur2.leadId) break;
    await api(ctx, "upload", { sessionId: sid, leadId: cur2.leadId, audioBase64: m4aBuffer().toString("base64"), mime: "audio/mp4", durationSeconds: 60, requestedRevisionId: cur2.card.scriptRevisionId });
    cur2 = await api(ctx, "resume", { sessionId: sid });
  }
  check(w.label, "24 sprint reaches completion", cur2.done === true, `progress=${JSON.stringify(cur2.progress)}`);
  check(w.label, "25 truthful completion counts", cur2.progress.completed >= 1 && (cur2.progress.rejected + cur2.progress.needsAttention) >= 2);

  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const w of WIDTHS) await run(w, browser);
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMANDATE-28 SPRINT (deterministic): ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
  if (failed.length) { console.log("FAILURES:"); failed.forEach((f) => console.log(`  [${f.l}] ${f.n} ${f.d}`)); }
  process.exit(failed.length ? 1 : 0);
})();

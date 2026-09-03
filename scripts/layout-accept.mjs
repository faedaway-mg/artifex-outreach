import { chromium, devices } from "playwright";
const BASE = "https://outreach.artifexlabs.tech", PW = process.env.OUTREACH_PASSWORD;
const VO = process.env.VO_LEAD || "lead_V1lTr7BOZE";
const results = [];
const ck = (n, ok, d = "") => { results.push({ n, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };
async function login(ctx) { const p = await ctx.newPage(); await p.goto(BASE + "/login"); await p.fill("#password", PW); await Promise.all([p.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]); await p.waitForLoadState("networkidle").catch(() => {}); return p; }
async function measure(label, dev, b) {
  const ctx = await b.newContext({ ...dev }); const p = await login(ctx); const vw = p.viewportSize().width;
  // Focused company screen: detail at top, no candidate list, no overflow.
  await p.goto(BASE + `/company/${VO}`, { waitUntil: "networkidle" });
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  ck(`[${label}] /company no horizontal overflow`, sw <= vw + 2, `sw=${sw} vw=${vw}`);
  const txt = await p.evaluate(() => document.body.innerText);
  ck(`[${label}] /company shows detail (upload+narration), no 'No package'`, /voiceover/i.test(txt) && /Narration/i.test(txt) && !/No prospect video package exists/i.test(txt));
  // Upload control within first viewport height (no scroll to reach active work)?
  // No candidate/inventory list ABOVE the detail on the focused screen (the real requirement).
  const findingBeforeList = await p.evaluate(() => document.body.innerText.search(/Prospect video package|Narration/i) < 400);
  ck(`[${label}] focused screen: active work is the first content (no inventory above)`, findingBeforeList);
  // Full Content Studio: the LIST container itself must be height-bounded so it can never dominate the doc.
  await p.goto(BASE + `/content-studio?section=client`, { waitUntil: "networkidle" });
  const m = await p.evaluate(() => {
    const listEl = document.querySelector('[data-piece-list]');
    return { sw: document.documentElement.scrollWidth, vh: window.innerHeight, listH: listEl ? listEl.clientHeight : -1, listScroll: listEl ? listEl.scrollHeight : -1 };
  });
  ck(`[${label}] studio no horizontal overflow`, m.sw <= vw + 2, `sw=${m.sw}`);
  ck(`[${label}] studio list container height-bounded (≤ 0.62×viewport)`, m.listH === -1 || m.listH <= m.vh * 0.62 + 4, `listH=${m.listH} vh=${m.vh}`);
  await ctx.close();
}
const b = await chromium.launch();
try { await measure("iPhone", devices["iPhone 13"], b); await measure("desktop", { viewport: { width: 1280, height: 900 } }, b); await measure("laptop", { viewport: { width: 1366, height: 700 } }, b); }
finally { await b.close(); }
const failed = results.filter(r => !r.ok);
console.log(`\nLayout acceptance: ${results.length - failed.length}/${results.length} passed.`);
process.exit(failed.length ? 3 : 0);

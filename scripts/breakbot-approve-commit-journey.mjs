// BREAKBOT MANDATE-20B JOURNEY — Breakbot clicks the REAL "Approve & schedule" button from BOTH entry
// points (Ready card + Full Package) and verifies the PERSISTED Ready→Scheduled transition (one binding,
// revision, dry-run selection, audit, zero provider calls) at three widths. Isolated instance; no runner
// invoked; nothing sent. Postconditions are read from the real snapshot/scheduler via /api/breakbot.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const OUT = "/tmp/bb-commit"; mkdirSync(OUT, { recursive: true });
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
async function leadState(api, leadId) { return (await api.get(`${BASE}/api/breakbot?action=lead-state&leadId=${leadId}`)).json(); }
async function waitScheduled(api, leadId, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await leadState(api, leadId); if (s.inScheduled >= 1) return s; await new Promise((r) => setTimeout(r, 500)); } return leadState(api, leadId); }

async function approveFrom(entry, w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const api = ctx.request;
  await api.post(`${BASE}/api/breakbot?action=reset`);
  const seed = await (await api.post(`${BASE}/api/breakbot?action=seed-approvable`)).json();
  const leadId = seed.leadId;
  const before = await leadState(api, leadId);
  check(w.label, `[${entry}] seeded approvable package appears once in Ready`, before.inReady === 1 && before.inScheduled === 0, `ready=${before.inReady} sched=${before.inScheduled}`);

  if (entry === "ready-card") {
    await page.goto(BASE + "/queue/ready", { waitUntil: "networkidle" });
  } else {
    await page.goto(BASE + `/company/${leadId}`, { waitUntil: "networkidle" });
    check(w.label, `[${entry}] Full Package shows the shared approve control`, (await page.locator("[data-approve-fullpackage]").count()) >= 1);
  }
  await page.getByRole("button", { name: /approve & schedule/i }).first().click();
  await page.getByText(/approved & scheduled/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  const after = await waitScheduled(api, leadId);
  check(w.label, `[${entry}] leaves Ready (inReady=0)`, after.inReady === 0, `inReady=${after.inReady}`);
  check(w.label, `[${entry}] appears exactly once in Scheduled`, after.inScheduled === 1, `inScheduled=${after.inScheduled}`);
  check(w.label, `[${entry}] exactly ONE binding with a frozen revision`, after.bindings === 1 && !!after.revisionId, `bindings=${after.bindings} rev=${after.revisionId}`);
  check(w.label, `[${entry}] binding passes validateScheduled + scheduler dry-run selects it`, after.validateOk && after.dryRunSelected);
  check(w.label, `[${entry}] a schedule audit event exists`, after.scheduleAudit);
  check(w.label, `[${entry}] Ready count decreased, Scheduled count increased`, after.readyCount === before.readyCount - 1 && after.scheduledCount === before.scheduledCount + 1, `ready ${before.readyCount}→${after.readyCount} sched ${before.scheduledCount}→${after.scheduledCount}`);
  const st = (await (await api.get(`${BASE}/api/breakbot`)).json()).state;
  check(w.label, `[${entry}] ZERO fake-provider calls / no send`, st.fakeProviderCalls === 0, `calls=${st.fakeProviderCalls}`);
  await page.screenshot({ path: `${OUT}/${w.label}-${entry}.png` });
  await api.post(`${BASE}/api/breakbot?action=reset`);
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) { await approveFrom("ready-card", w, browser); await approveFrom("full-package", w, browser); } } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-20B COMMIT JOURNEY: ${results.length - failed.length}/${results.length} checks passed across 3 widths (both entry points). Screenshots in ${OUT}.`);
process.exit(failed.length ? 1 : 0);

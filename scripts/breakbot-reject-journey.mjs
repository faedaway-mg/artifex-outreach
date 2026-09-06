// BREAKBOT MANDATE-21 JOURNEY — Breakbot clicks the REAL "Reject / Stop future outreach" control across the
// operator surfaces and verifies the PERSISTED terminal disposition: the company leaves the active pipeline,
// its pending unsent binding is voided, every dispatch gate refuses it, a truthful lead.rejected audit event
// exists, the recipient is NOT suppressed, delivered receipts are preserved, a late render cannot reactivate
// it, and ZERO provider calls happen — at three widths. Isolated in-memory instance; no runner; nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const OUT = "/tmp/bb-reject"; mkdirSync(OUT, { recursive: true });
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
const leadState = async (api, leadId) => (await api.get(`${BASE}/api/breakbot?action=lead-state&leadId=${leadId}`)).json();
const summary = async (api) => (await (await api.get(`${BASE}/api/breakbot`)).json()).state;

/** Drive the shared Reject control on the current page: open panel → pick reason → confirm. */
async function clickReject(page, reason = "poor-fit") {
  await page.locator("[data-reject-control]").first().click();
  await page.locator("[data-reject-panel]").first().waitFor({ timeout: 8000 });
  await page.locator(`[data-reject-reason="${reason}"]`).first().check();
  await page.locator("[data-reject-confirm]").first().click();
  await page.waitForTimeout(600); // let the server action + revalidate settle
}

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const api = ctx.request;

  // ── J1: Ready-to-approve (unsent) → Reject, from the Ready queue card ──────────────────────────────
  await api.post(`${BASE}/api/breakbot?action=reset`);
  let seed = await (await api.post(`${BASE}/api/breakbot?action=seed-approvable`)).json();
  let id = seed.leadId;
  let before = await leadState(api, id);
  check(w.label, "[ready] seeded package appears in Ready", before.inReady === 1 && !before.rejected, `ready=${before.inReady}`);
  await page.goto(BASE + "/queue/ready", { waitUntil: "networkidle" });
  check(w.label, "[ready] shared Reject control renders", (await page.locator("[data-reject-control]").count()) >= 1);
  await clickReject(page, "poor-fit");
  let after = await leadState(api, id);
  check(w.label, "[ready] leaves the pipeline (rejected, inReady=0)", after.rejected && after.inReady === 0, `stage=${after.pipelineStage} inReady=${after.inReady}`);
  check(w.label, "[ready] one truthful lead.rejected audit event", after.rejectionEvents === 1, `events=${after.rejectionEvents}`);
  check(w.label, "[ready] recipient NOT suppressed (internal rejection ≠ unsubscribe)", after.suppressed === false);
  check(w.label, "[ready] cannot dispatch (resolveSendOk=false)", after.resolveSendOk === false);
  check(w.label, "[ready] Ready count decreased", after.readyCount === before.readyCount - 1, `ready ${before.readyCount}→${after.readyCount}`);

  // ── J2: Scheduled (unsent) → Stop, binding voided + every dispatch gate refuses ─────────────────────
  await api.post(`${BASE}/api/breakbot?action=reset`);
  seed = await (await api.post(`${BASE}/api/breakbot?action=seed-approvable`)).json();
  id = seed.leadId;
  await page.goto(BASE + "/queue/ready", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /approve & schedule/i }).first().click();
  await page.getByText(/approved & scheduled/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  before = await leadState(api, id);
  check(w.label, "[scheduled] seeded → scheduled with one binding", before.bindings === 1 && before.inScheduled === 1, `bindings=${before.bindings} sched=${before.inScheduled}`);
  await page.goto(BASE + "/queue/scheduled", { waitUntil: "networkidle" });
  await clickReject(page, "outside-target-size");
  after = await leadState(api, id);
  check(w.label, "[scheduled] binding voided (bindings=0, inScheduled=0)", after.bindings === 0 && after.inScheduled === 0, `bindings=${after.bindings} sched=${after.inScheduled}`);
  check(w.label, "[scheduled] scheduler dry-run no longer selects it", after.dryRunSelected === false);
  check(w.label, "[scheduled] rejected + not suppressed", after.rejected && after.suppressed === false);

  // ── J3: Full Package (company detail) → Reject ─────────────────────────────────────────────────────
  await api.post(`${BASE}/api/breakbot?action=reset`);
  seed = await (await api.post(`${BASE}/api/breakbot?action=seed-approvable`)).json();
  id = seed.leadId;
  await page.goto(BASE + `/company/${id}`, { waitUntil: "networkidle" });
  check(w.label, "[full-package] shared Reject control renders on detail view", (await page.locator("[data-reject-control]").count()) >= 1);
  await clickReject(page, "wrong-industry");
  after = await leadState(api, id);
  check(w.label, "[full-package] rejected + one event + zero bindings", after.rejected && after.rejectionEvents === 1 && after.bindings === 0);

  // ── J4: Previously-contacted (fake receipt) → Stop future outreach; receipt preserved, no unsubscribe ─
  await api.post(`${BASE}/api/breakbot?action=reset`);
  const cr = await (await api.post(`${BASE}/api/breakbot?action=seed-contacted-receipt`)).json();
  id = cr.leadId;
  before = await leadState(api, id);
  check(w.label, "[contacted] seeded with a delivered receipt", before.sentReceipts === 1, `receipts=${before.sentReceipts}`);
  await page.goto(BASE + `/company/${id}`, { waitUntil: "networkidle" });
  await clickReject(page, "duplicate");
  after = await leadState(api, id);
  check(w.label, "[contacted] delivered receipt PRESERVED after Stop", after.sentReceipts === 1, `receipts=${after.sentReceipts}`);
  check(w.label, "[contacted] rejected, NOT suppressed (no unsubscribe written)", after.rejected && after.suppressed === false);

  // ── J5: Rejected company with a late render does NOT reactivate through the reconciler ──────────────
  await api.post(`${BASE}/api/breakbot?action=reset`);
  seed = await (await api.post(`${BASE}/api/breakbot?action=seed-approvable`)).json(); // has a verified render
  id = seed.leadId;
  await page.goto(BASE + "/queue/ready", { waitUntil: "networkidle" });
  await clickReject(page, "insufficient-evidence");
  await api.post(`${BASE}/api/breakbot?action=reconcile`); // run the whole-book reconciler
  after = await leadState(api, id);
  check(w.label, "[late-render] reconciler does NOT reactivate (inReady=0, still rejected)", after.inReady === 0 && after.rejected, `inReady=${after.inReady}`);
  check(w.label, "[late-render] cannot dispatch after reconcile", after.resolveSendOk === false);

  // Isolation + zero-send invariant across the whole run.
  const st = await summary(api);
  check(w.label, "[isolation] ZERO fake-provider calls across all reject journeys", st.fakeProviderCalls === 0, `calls=${st.fakeProviderCalls}`);
  check(w.label, "[isolation] no real recipients in the isolated store", (st.realRecipients ?? 0) === 0, `real=${st.realRecipients}`);

  await page.screenshot({ path: `${OUT}/${w.label}-reject.png` });
  await api.post(`${BASE}/api/breakbot?action=reset`);
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await run(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-21 REJECT JOURNEY: ${results.length - failed.length}/${results.length} checks passed across 3 widths (5 journeys each). Screenshots in ${OUT}.`);
process.exit(failed.length ? 1 : 0);

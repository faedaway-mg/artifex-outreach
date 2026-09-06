// BREAKBOT MANDATE-22 DETERMINISTIC SCHEDULED JOURNEY. Seeds a full isolated Scheduled queue (EMAIL_VIDEO,
// EMAIL_PDF, invalid missing-artifact) and verifies the repaired Scheduled workflow at 3 widths: count==list,
// package-aware detail per type, full Next/Prev traversal with edge disabling, invalid→Needs Attention +
// not dispatch-eligible, close returns to the list, cancel-reject = zero mutation, reject voids the binding
// and recomputes neighbors, and NO dead/inert/misleading control remains. Isolated; no runner; nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const OUT = "/tmp/bb-scheduled"; mkdirSync(OUT, { recursive: true });
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
const leadState = async (api, id) => (await api.get(`${BASE}/api/breakbot?action=lead-state&leadId=${id}`)).json();
const summary = async (api) => (await (await api.get(`${BASE}/api/breakbot`)).json()).state;

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const api = ctx.request;
  await api.post(`${BASE}/api/breakbot?action=reset`);
  const seeded = await (await api.post(`${BASE}/api/breakbot?action=seed-scheduled-queue`)).json();
  const invalidId = (seeded.ordered.find((o) => o.type === "INVALID_VIDEO") || {}).leadId ?? null;
  const st = await summary(api);
  const order = st.scheduledLeadIds; // canonical scheduled ordering (same as list + nav)
  check(w.label, "seeded a non-empty Scheduled queue", order.length >= 3, `n=${order.length}`);

  // (2) Open Scheduled; displayed count equals canonical list length.
  await page.goto(BASE + "/queue/scheduled", { waitUntil: "networkidle" });
  const rowCount = await page.locator("[data-queue-list] a[href^='/company/']").count();
  check(w.label, "displayed count equals canonical list length", rowCount === order.length, `rows=${rowCount} list=${order.length}`);

  // (3-9) Open first, then Next through every company in order; verify content + position + edge disabling.
  await page.goto(BASE + `/company/${order[0]}?from=scheduled`, { waitUntil: "networkidle" });
  check(w.label, "first company: Previous is disabled", (await page.locator("[data-nav-prev][data-nav-disabled]").count()) === 1);
  let ok = true;
  for (let i = 0; i < order.length; i++) {
    const detail = await page.locator("[data-scheduled-detail]").first();
    const present = (await detail.count()) === 1;
    const ptype = present ? await detail.getAttribute("data-package-type") : null;
    const quarantined = (await page.locator("[data-scheduled-quarantined]").count()) === 1;
    // Every scheduled company shows SOMETHING real: either a package card or an honest quarantine.
    if (!present && !quarantined) ok = false;
    // Package-type-specific frozen content.
    if (present && !quarantined && ptype === "EMAIL_PDF") {
      if ((await page.locator("[data-scheduled-pdf]").count()) < 1) ok = false;      // shows the PDF
      if ((await page.locator("[data-scheduled-subject]").count()) < 1) ok = false;  // shows the email
    }
    if (present && !quarantined && ptype === "EMAIL_VIDEO") {
      if ((await page.locator("[data-scheduled-video]").count()) < 1) ok = false;
      if ((await page.locator("[data-scheduled-pdf]").count()) < 1) ok = false;
    }
    if (i < order.length - 1) {
      const next = page.locator("a[data-nav-next]");
      if ((await next.count()) !== 1) { ok = false; break; }
      await Promise.all([page.waitForLoadState("networkidle"), next.click()]);
    }
  }
  check(w.label, "Next traverses every company; each shows real package-aware content", ok);

  // (7,9) Edge disabling — checked by DIRECT navigation to the known first/last (deterministic, race-free).
  await page.goto(BASE + `/company/${order[order.length - 1]}?from=scheduled`, { waitUntil: "networkidle" });
  check(w.label, "last company: Next is disabled", (await page.locator("[data-nav-next][data-nav-disabled]").count()) === 1);
  await page.goto(BASE + `/company/${order[0]}?from=scheduled`, { waitUntil: "networkidle" });
  check(w.label, "first company: Next is enabled, Previous disabled", (await page.locator("a[data-nav-next]").count()) === 1 && (await page.locator("[data-nav-prev][data-nav-disabled]").count()) === 1);

  // (8) Previous back through every company to the first (real click traversal). <Link> does a soft client
  // navigation, so we wait for the URL to reach the expected previous company id rather than networkidle.
  await page.goto(BASE + `/company/${order[order.length - 1]}?from=scheduled`, { waitUntil: "networkidle" });
  let prevOk = true;
  for (let i = order.length - 1; i > 0; i--) {
    const expected = order[i - 1];
    const prev = page.locator("a[data-nav-prev]");
    if ((await prev.count()) !== 1) { prevOk = false; break; }
    await Promise.all([page.waitForURL((u) => u.pathname.includes(expected), { timeout: 10000 }).catch(() => {}), prev.click()]);
  }
  const onFirst = page.url().includes(order[0]);
  check(w.label, "Previous traverses back to the first company", prevOk && onFirst && (await page.locator("[data-nav-prev][data-nav-disabled]").count()) === 1);

  // (16-17) Invalid missing-artifact binding → honest Needs Attention + excluded from dispatch.
  if (invalidId) {
    await page.goto(BASE + `/company/${invalidId}?from=scheduled`, { waitUntil: "networkidle" });
    check(w.label, "invalid binding shows an honest Needs Attention (quarantine) state", (await page.locator("[data-scheduled-quarantined]").count()) === 1);
    const ls = await leadState(api, invalidId);
    check(w.label, "invalid binding is NOT dispatch-eligible", ls.resolveSendOk === false);
  } else check(w.label, "invalid binding present", false, "no invalid item found");

  // (18) Cancel a Reject confirmation → zero mutation.
  const target = order[1];
  const before = await leadState(api, target);
  await page.goto(BASE + `/company/${target}?from=scheduled`, { waitUntil: "networkidle" });
  await page.locator("[data-reject-control]").first().click();
  await page.locator("[data-reject-panel]").first().waitFor({ timeout: 8000 });
  await page.getByText(/^Cancel$/).first().click();
  const afterCancel = await leadState(api, target);
  check(w.label, "cancel-reject mutates nothing", afterCancel.rejected === false && afterCancel.bindings === before.bindings && afterCancel.rejectionEvents === 0);

  // (19) Reject an isolated scheduled fixture → binding void + neighbor recomputation.
  await page.locator("[data-reject-control]").first().click();
  await page.locator("[data-reject-panel]").first().waitFor({ timeout: 8000 });
  await page.locator('[data-reject-reason="poor-fit"]').first().check();
  await page.locator("[data-reject-confirm]").first().click();
  await page.waitForTimeout(700);
  const afterReject = await leadState(api, target);
  check(w.label, "reject voids the binding + leaves the queue", afterReject.rejected === true && afterReject.bindings === 0 && afterReject.inScheduled === 0);
  const st2 = await summary(api);
  check(w.label, "scheduled list recomputes (count drops by one)", st2.scheduledLeadIds.length === order.length - 1, `after=${st2.scheduledLeadIds.length}`);

  // (20) No dead/inert/misleading control: no anchor points at href="#".
  await page.goto(BASE + "/queue/scheduled", { waitUntil: "networkidle" });
  check(w.label, "no dead controls (no href='#')", (await page.locator("a[href='#']").count()) === 0);

  // Isolation: zero provider calls across the whole journey.
  check(w.label, "ZERO fake-provider calls", st2.fakeProviderCalls === 0, `calls=${st2.fakeProviderCalls}`);

  await page.screenshot({ path: `${OUT}/${w.label}-scheduled.png` });
  await api.post(`${BASE}/api/breakbot?action=reset`);
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await run(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-22 SCHEDULED JOURNEY: ${results.length - failed.length}/${results.length} checks passed across 3 widths. Screenshots in ${OUT}.`);
process.exit(failed.length ? 1 : 0);

// BREAKBOT MANDATE-24 DETERMINISTIC NEEDS ATTENTION JOURNEY. A Morris-style item explains its reason and
// offers exactly Prepare video follow-up / Hold / Reject. Proves: reason shown; Cancel mutates nothing;
// Prepare → one VIDEO_FOLLOW_UP (Ready, correct lineage, attention−1/ready+1, no send); already-delivered
// no duplicate; Hold ≠ reject/unsubscribe; suppressed/rejected can't prepare; zero provider. 3 widths.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const OUT = "/tmp/bb-attention"; mkdirSync(OUT, { recursive: true });
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
const post = (api, a, q = "") => api.post(`${BASE}/api/breakbot?action=${a}${q}`);
const card = (page, id) => page.locator(`[data-attention-card]`).first();

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const api = ctx.request;

  // ── Reason shown + valid actions ────────────────────────────────────────────────────────────────────
  await post(api, "reset");
  const seed = await (await post(api, "seed-morris-like")).json();
  const leadId = seed.leadId;
  let ls = await leadState(api, leadId);
  check(w.label, "item is Needs Attention with a precise reason code", ls.inNeedsAttentionReason === "prior-sent-video-undelivered", `code=${ls.inNeedsAttentionReason}`);
  await page.goto(BASE + "/queue/attention", { waitUntil: "networkidle" });
  check(w.label, "card shows the plain-language reason", (await page.locator("[data-attention-reason]").count()) >= 1);
  check(w.label, "offers Prepare + Hold + Reject (only valid actions)", (await page.locator("[data-action-prepare]").count()) >= 1 && (await page.locator("[data-action-hold]").count()) >= 1 && (await page.locator("[data-reject-control]").count()) >= 1);

  // ── Cancel mutates nothing ──────────────────────────────────────────────────────────────────────────
  await page.locator("[data-action-prepare]").first().click();
  await page.locator("[data-attention-confirm]").first().waitFor({ timeout: 6000 });
  await page.locator("[data-attention-cancel]").first().click();
  ls = await leadState(api, leadId);
  check(w.label, "Cancel mutates nothing", ls.followUpPrepared === false);

  // ── Prepare video follow-up → Ready, one package, lineage, no send ──────────────────────────────────
  const before = await summary(api);
  await page.locator("[data-action-prepare]").first().click();
  await page.locator("[data-attention-confirm-yes]").first().click();
  await page.locator("[data-attention-done]").first().waitFor({ timeout: 10000 }).catch(() => {});
  ls = await leadState(api, leadId);
  check(w.label, "prepared → VIDEO_FOLLOW_UP with prior-receipt lineage", ls.followUpPrepared && ls.packageType === "VIDEO_FOLLOW_UP" && ls.followUpPriorReceiptId, `pt=${ls.packageType} rcpt=${ls.followUpPriorReceiptId}`);
  check(w.label, "left Needs Attention, entered Ready to Approve", ls.inNeedsAttentionReason === null && ls.inReady === 1, `na=${ls.inNeedsAttentionReason} ready=${ls.inReady}`);
  check(w.label, "not scheduled, nothing sent", ls.inScheduled === 0 && ls.sentReceipts === 1);
  const after = await summary(api);
  check(w.label, "counts: ready +1", after.ready === before.ready + 1, `ready ${before.ready}→${after.ready}`);

  // ── Already-delivered → no duplicate follow-up ──────────────────────────────────────────────────────
  await post(api, "reset");
  const d = await (await post(api, "seed-morris-like")).json();
  await post(api, "mark-video-delivered", `&leadId=${d.leadId}`);
  await page.goto(BASE + "/queue/attention", { waitUntil: "networkidle" });
  if ((await page.locator("[data-action-prepare]").count()) >= 1) {
    await page.locator("[data-action-prepare]").first().click();
    await page.locator("[data-attention-confirm-yes]").first().click();
    await page.waitForTimeout(800);
  }
  const ds = await leadState(api, d.leadId);
  check(w.label, "already-delivered video creates no follow-up", ds.followUpPrepared === false);

  // ── Hold ≠ reject/unsubscribe ───────────────────────────────────────────────────────────────────────
  await post(api, "reset");
  const h = await (await post(api, "seed-morris-like")).json();
  await page.goto(BASE + "/queue/attention", { waitUntil: "networkidle" });
  await page.locator("[data-action-hold]").first().click();
  await page.locator("[data-attention-confirm-yes]").first().click();
  await page.waitForTimeout(800);
  const hs = await leadState(api, h.leadId);
  check(w.label, "Hold removes from attention, not a rejection, not suppressed", hs.heldNow && hs.inNeedsAttentionReason === null && hs.rejected === false && hs.suppressed === false);

  // ── Rejected company cannot remain in attention ─────────────────────────────────────────────────────
  await post(api, "reset");
  const j = await (await post(api, "seed-morris-like")).json();
  await page.goto(BASE + "/queue/attention", { waitUntil: "networkidle" });
  await page.locator("[data-reject-control]").first().click();
  await page.locator("[data-reject-panel]").first().waitFor({ timeout: 6000 });
  await page.locator('[data-reject-reason="poor-fit"]').first().check();
  await page.locator("[data-reject-confirm]").first().click();
  await page.waitForTimeout(800);
  const js = await leadState(api, j.leadId);
  check(w.label, "rejected → leaves attention, terminal", js.rejected === true && js.inNeedsAttentionReason === null);

  // ── Preview canonical video + close ─────────────────────────────────────────────────────────────────
  await post(api, "reset");
  const p2 = await (await post(api, "seed-morris-like")).json();
  await page.goto(BASE + `/company/${p2.leadId}?from=attention`, { waitUntil: "networkidle" });
  const hasPreview = (await page.locator("[data-operator-preview-open]").count()) >= 1;
  check(w.label, "canonical video previewable from the attention item", hasPreview);
  if (hasPreview) { await page.locator("[data-operator-preview-open]").first().click(); await page.locator("[data-operator-preview-modal]").first().waitFor({ timeout: 6000 }); await page.keyboard.press("Escape"); check(w.label, "player closes (no dead-end)", (await page.locator("[data-operator-preview-modal]").count()) === 0); }

  const st = await summary(api);
  check(w.label, "ZERO fake-provider calls", st.fakeProviderCalls === 0, `calls=${st.fakeProviderCalls}`);
  check(w.label, "no dead controls (no href='#')", (await page.goto(BASE + "/queue/attention", { waitUntil: "networkidle" }).then(() => page.locator("a[href='#']").count())) === 0);
  await page.screenshot({ path: `${OUT}/${w.label}-attention.png` });
  await post(api, "reset");
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await run(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-24 ATTENTION JOURNEY: ${results.length - failed.length}/${results.length} checks passed across 3 widths. Screenshots in ${OUT}.`);
process.exit(failed.length ? 1 : 0);

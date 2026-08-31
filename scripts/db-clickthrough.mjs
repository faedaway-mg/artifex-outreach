// DB-backed intercepted click-through — one STAGE per invocation so the orchestrator can
// RESTART the app between stages (proving Postgres persistence). Shared state (auth cookie
// via Playwright storageState + the seeded agreement id + per-stage proofs) lives in
// STATE_DIR so each fresh process resumes the same flow against the restarted server.
//
// Providers intercepted (fake e-sign + dev complete-signing); production flags OFF; no real
// SignWell/Stripe. Requires the app running DB-backed (DATABASE_URL set to the local test DB).
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const STATE = process.env.STATE_DIR || "/tmp/db-ct";
const STAGE = process.env.STAGE || "";
const OUT = process.env.HOME + "/acq-os-audit/closing-ui-db-clickthrough";
fs.mkdirSync(STATE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const norm = (s) => (s || "").replace(/\s+/g, " ");
let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} [${STAGE}] ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}
function saveJson(f, o) { fs.writeFileSync(`${STATE}/${f}`, JSON.stringify(o)); }
function loadJson(f) { return JSON.parse(fs.readFileSync(`${STATE}/${f}`, "utf8")); }
function appendProof(label, info) {
  fs.appendFileSync(`${STATE}/proofs.jsonl`, JSON.stringify({ label, ...info }) + "\n");
}

async function newCtx(browser, withState) {
  return browser.newContext({ viewport: { width: 1280, height: 900 }, ...(withState ? { storageState: `${STATE}/auth.json` } : {}) });
}
async function bodyText(page) { return norm(await page.evaluate(() => document.body?.innerText || "")); }
async function testid(page, id) {
  const el = page.locator(`[data-testid="${id}"]`).first();
  return (await el.count()) ? norm(await el.innerText()) : null;
}

async function frozenInfo(ctx, id) {
  const r = await ctx.request.post(`${BASE}/api/dev/rehearsal`, { data: { op: "frozen-pdf-info", id } });
  return r.json();
}

async function main() {
  const browser = await chromium.launch();

  if (STAGE === "seed_approve") {
    const ctx = await newCtx(browser, false);
    // maxRedirects:0 — we only need the Set-Cookie; do NOT follow the 303 into the
    // (cold-compiling) homepage, which would time out. 303 counts as a successful login.
    const login = await ctx.request.post(`${BASE}/api/auth/login`, { form: { password: process.env.OUTREACH_PASSWORD || "artifex", from: "/" }, maxRedirects: 0, timeout: 60000 });
    check("login ok", login.status() === 303 || login.ok(), `http ${login.status()}`);
    const seedResp = await ctx.request.post(`${BASE}/api/dev/rehearsal`, { data: { op: "seed", suffix: "DBCT" } });
    const seed = await seedResp.json();
    check("seed agreement (DB)", seedResp.ok() && seed.ok && seed.id, JSON.stringify(seed));
    await ctx.storageState({ path: `${STATE}/auth.json` });
    saveJson("agreement.json", { id: seed.id });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`${BASE}/closing/${seed.id}`, { waitUntil: "networkidle", timeout: 60000 });
    check("draft: eligibility not signed", /not signed/i.test(await testid(page, "eligibility-label")));
    await page.locator("button", { hasText: "Approve for signing" }).first().click();
    await page.waitForSelector('[data-testid="approval-receipt"]', { timeout: 60000 });
    check("approved: receipt shown", /Approved · receipt digest/.test(await testid(page, "approval-receipt")));
    await page.screenshot({ path: `${OUT}/01-approved.png`, fullPage: true });
    const info = await frozenInfo(ctx, seed.id);
    check("frozen PDF stored at approval", info.ok && info.frozen && info.frozen.storedSha, JSON.stringify(info.frozen));
    check("frozen storedSha == recomputedSha (bytes intact)", info.frozen && info.frozen.storedSha === info.frozen.recomputedSha);
    check("approval binding SHA == frozen SHA", info.approvalBindingSha === info.frozen?.storedSha, `${info.approvalBindingSha} vs ${info.frozen?.storedSha}`);
    appendProof("after_approve", info);
  }

  else if (STAGE === "authorize") {
    const { id } = loadJson("agreement.json");
    const ctx = await newCtx(browser, true);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`${BASE}/closing/${id}`, { waitUntil: "networkidle", timeout: 60000 });
    check("persisted across restart: approved receipt still shown", /Approved · receipt digest/.test(await testid(page, "approval-receipt")));
    await page.locator("button", { hasText: "Authorize send" }).first().click();
    await page.waitForSelector('button:has-text("Send agreement")', { timeout: 60000 });
    check("authorized: Send agreement enabled", await page.locator('button:has-text("Send agreement")').first().isEnabled());
    await page.screenshot({ path: `${OUT}/02-authorized.png`, fullPage: true });
    const info = await frozenInfo(ctx, id);
    check("frozen unchanged at authorize", info.frozen && info.frozen.storedSha === info.frozen.recomputedSha);
    check("send-auth binding SHA == frozen SHA", info.sendAuthSha === info.frozen?.storedSha, `${info.sendAuthSha} vs ${info.frozen?.storedSha}`);
    appendProof("after_authorize", info);
  }

  else if (STAGE === "send_sign") {
    const { id } = loadJson("agreement.json");
    const ctx = await newCtx(browser, true);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`${BASE}/closing/${id}`, { waitUntil: "networkidle", timeout: 60000 });
    check("persisted across restart: Send agreement present", await page.locator('button:has-text("Send agreement")').count() > 0);
    await page.locator('button:has-text("Send agreement")').first().click();
    await page.waitForSelector('[data-testid="send-consumed"]', { timeout: 60000 });
    check("sent: 'already been sent'", /already been sent/i.test(await testid(page, "send-consumed")));
    check("sent: send-auth badge 'Sent'", (await bodyText(page)).includes("Sent"));
    check("sent: NOT 'Not authorized'", !(await bodyText(page)).includes("Not authorized"));
    await page.screenshot({ path: `${OUT}/03-sent.png`, fullPage: true });
    const info = await frozenInfo(ctx, id);
    check("frozen unchanged at send", info.frozen && info.frozen.storedSha === info.frozen.recomputedSha);
    check("send consumed + esignRequestId set", !!info.sendAuthConsumedAt && !!info.esignRequestId, JSON.stringify({ consumedAt: info.sendAuthConsumedAt, req: info.esignRequestId }));
    appendProof("after_send", info);
    // Intercepted signing completion, then verify signed state.
    const comp = await (await ctx.request.post(`${BASE}/api/dev/rehearsal`, { data: { op: "complete-signing", id } })).json();
    check("complete-signing ok", comp.ok, JSON.stringify(comp));
    await page.reload({ waitUntil: "networkidle", timeout: 60000 });
    check("signed: overall 'Completed'", (await testid(page, "signing-overall")) === "Completed", await testid(page, "signing-overall"));
    check("signed: 2 of 2 signers", /2 of 2/.test(await testid(page, "signers-count")));
    check("signed: retention 'Not required' (test)", (await testid(page, "retention-status")) === "Not required");
    check("pay: eligible for TEST payment", /TEST payment/i.test(await testid(page, "eligibility-label")));
    await page.screenshot({ path: `${OUT}/04-signed.png`, fullPage: true });
  }

  else if (STAGE === "verify_persist") {
    const { id } = loadJson("agreement.json");
    const ctx = await newCtx(browser, true);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/closing/${id}`, { waitUntil: "networkidle", timeout: 60000 });
    // Fresh server + fresh page load: everything comes from Postgres.
    check("after restart: overall 'Completed'", (await testid(page, "signing-overall")) === "Completed", await testid(page, "signing-overall"));
    check("after restart: consumed send-auth still 'Sent'", (await bodyText(page)).includes("Sent") && !(await bodyText(page)).includes("Not authorized"));
    check("after restart: 'already been sent' copy", /already been sent/i.test(await testid(page, "send-consumed")));
    check("after restart: eligible for TEST payment", /TEST payment/i.test(await testid(page, "eligibility-label")));
    check("after restart: no horizontal overflow", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));
    const info = await frozenInfo(ctx, id);
    check("after restart: frozen PDF still intact", info.frozen && info.frozen.storedSha === info.frozen.recomputedSha);
    appendProof("after_restart_verify", info);
  }

  else { console.log(`unknown STAGE '${STAGE}'`); failures++; }

  await browser.close();
  console.log(`[${STAGE}] ${failures ? `FAILURES: ${failures}` : "stage OK"}`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

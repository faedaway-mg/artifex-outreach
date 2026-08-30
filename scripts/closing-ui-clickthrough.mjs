// Gate 4 — INTERCEPTED UI click-through rehearsal of the REAL closing workspace.
// Drives /closing/[id] through approve → authorize → send → sign → (retain) → pay by
// clicking the actual buttons, with providers intercepted:
//   • SignWell: the guarded in-process fake provider (ESIGN_FAKE_PROVIDER=1, non-prod,
//     no live key) — NO real SignWell call.
//   • Signing completion: a dev-only rehearsal route marks the doc signed (the webhook's
//     terminal transition) — NO real webhook.
//   • Stripe: never called — with the production flags OFF the runtime is TEST mode, so
//     billing lands at ELIGIBLE_TEST_PAYMENT (no live payment path is reachable).
// The dev server must run with ESIGN_FAKE_PROVIDER=1 and the production flags OFF.
import { chromium } from "playwright";
import fs from "fs";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const OUT = process.env.HOME + "/acq-os-audit/closing-ui-clickthrough";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  results.push({ name, ok, detail: ok ? undefined : detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}
const norm = (s) => (s || "").replace(/\s+/g, " ");

async function bodyText(page) {
  return norm(await page.evaluate(() => document.body?.innerText || ""));
}
async function testid(page, id) {
  const el = page.locator(`[data-testid="${id}"]`).first();
  return (await el.count()) ? norm(await el.innerText()) : null;
}
async function shot(page, label) {
  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // 1) Authenticate (dev password) — the session cookie is stored on the context.
  const login = await ctx.request.post(`${BASE}/api/auth/login`, {
    form: { password: process.env.OUTREACH_PASSWORD || "artifex", from: "/" },
  });
  check("login ok", login.ok(), `http ${login.status()}`);

  // 2) Seed a fresh DRAFT (test-mode) agreement into the running dev store.
  const seedResp = await ctx.request.post(`${BASE}/api/dev/rehearsal`, {
    data: { op: "seed", suffix: "CT01" },
  });
  const seed = await seedResp.json().catch(() => ({}));
  check("seed agreement", seedResp.ok() && seed.ok && seed.id, JSON.stringify(seed));
  const id = seed.id;
  if (!id) { console.log("NO agreement id — aborting"); await browser.close(); process.exit(1); }

  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept()); // auto-confirm the window.confirm() gates
  const url = `${BASE}/closing/${id}`;

  // ── Stage: DRAFT ────────────────────────────────────────────────────────────
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await shot(page, "01-draft");
  check("draft: Stripe TEST badge", (await testid(page, "stripe-mode")) === "Stripe TEST", await testid(page, "stripe-mode"));
  check("draft: eligibility not signed", /not signed/i.test(await testid(page, "eligibility-label")), await testid(page, "eligibility-label"));
  check("draft: has Approve action", (await bodyText(page)).includes("Approve for signing"));
  check("draft: no live-payment card", !(await bodyText(page)).includes("Authorize this exact live payment"));

  // ── Stage: APPROVE ──────────────────────────────────────────────────────────
  await page.locator("button", { hasText: "Approve for signing" }).first().click();
  await page.waitForSelector('[data-testid="approval-receipt"]', { timeout: 20000 });
  await shot(page, "02-approved");
  check("approved: receipt shown", /Approved · receipt digest/.test(await testid(page, "approval-receipt")), await testid(page, "approval-receipt"));
  check("approved: no Approve button remains", !(await bodyText(page)).includes("Approve for signing"));
  check("approved: not Invalidated", !(await bodyText(page)).includes("Invalidated"));

  // ── Stage: AUTHORIZE SEND ─────────────────────────────────────────────────────
  await page.locator("button", { hasText: "Authorize send" }).first().click();
  await page.waitForSelector('button:has-text("Send agreement")', { timeout: 20000 });
  await shot(page, "03-authorized");
  check("authorized: send-auth badge 'Authorized'", (await bodyText(page)).includes("Authorized"));
  check("authorized: Send agreement enabled", await page.locator('button:has-text("Send agreement")').first().isEnabled());

  // ── Stage: SEND (fake provider) ───────────────────────────────────────────────
  await page.locator('button:has-text("Send agreement")').first().click();
  try {
    await page.waitForSelector('[data-testid="send-consumed"]', { timeout: 20000 });
  } catch (e) {
    await page.waitForTimeout(1500);
    const sendCard = page.locator('[data-testid="closing-workspace"]');
    console.log("---- SEND DIAGNOSTIC (body excerpt) ----");
    console.log((await bodyText(page)).slice(0, 1200));
    console.log("---- end diagnostic ----");
    throw e;
  }
  await shot(page, "04-sent");
  check("sent: 'already been sent' copy", /already been sent/i.test(await testid(page, "send-consumed")), await testid(page, "send-consumed"));
  check("sent: send-auth badge 'Sent'", (await bodyText(page)).includes("Sent"));
  check("sent: badge NOT 'Not authorized'", !(await bodyText(page)).includes("Not authorized"));
  check("sent: overall 'Sent'", (await testid(page, "signing-overall")) === "Sent", await testid(page, "signing-overall"));

  // ── Stage: SIGN (intercepted completion) ──────────────────────────────────────
  const compResp = await ctx.request.post(`${BASE}/api/dev/rehearsal`, { data: { op: "complete-signing", id } });
  const comp = await compResp.json().catch(() => ({}));
  check("complete-signing ok", compResp.ok() && comp.ok, JSON.stringify(comp));
  await page.reload({ waitUntil: "networkidle", timeout: 45000 });
  await shot(page, "05-signed");
  check("signed: overall 'Completed'", (await testid(page, "signing-overall")) === "Completed", await testid(page, "signing-overall"));
  check("signed: 2 of 2 signers", /2 of 2/.test(await testid(page, "signers-count")), await testid(page, "signers-count"));
  check("signed: retention 'Not required' (test)", (await testid(page, "retention-status")) === "Not required", await testid(page, "retention-status"));

  // ── Stage: PAY (test-mode eligibility; no live Stripe reachable) ──────────────
  check("pay: eligible for TEST payment", /TEST payment/i.test(await testid(page, "eligibility-label")), await testid(page, "eligibility-label"));
  check("pay: Stripe still TEST", (await testid(page, "stripe-mode")) === "Stripe TEST", await testid(page, "stripe-mode"));
  check("pay: no live-payment card (flags OFF ⇒ test)", !(await bodyText(page)).includes("Authorize this exact live payment"));

  // ── Cross-cutting coherence at the terminal state ─────────────────────────────
  const finalBody = await bodyText(page);
  check("coherence: no Approve button at signed", !finalBody.includes("Approve for signing"));
  check("coherence: no 'Authorize sending first' at signed", !finalBody.includes("Authorize sending first"));
  check("coherence: no Invalidated at signed", !finalBody.includes("Invalidated"));
  check("coherence: no horizontal overflow", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));

  await browser.close();
  console.log("\n" + (failures ? `CLICK-THROUGH FAILURES: ${failures}` : "CLICK-THROUGH ALL CHECKS OK"));
  console.log(`screenshots → ${OUT}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

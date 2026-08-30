// Gate 16: desktop + iPhone browser acceptance of the closing workspace dev preview.
// Visits /dev/closing-workspace?state=<S> at 1280x900 and 390x844, screenshots each,
// and asserts key invariants. NO real provider/Stripe — the dev preview is synthetic.
import { chromium, devices } from "playwright";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.HOME + "/acq-os-audit/closing-ui-screenshots";
import fs from "fs";
fs.mkdirSync(OUT, { recursive: true });
const STATES = ["draft", "approved", "send_authorized", "partial", "completed", "retention_failed", "retained", "eligible_live", "paid", "unverified"];
const browser = await chromium.launch();
const results = [];
async function shot(state, label, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? devices["iPhone 13"] : {}), storageState: undefined });
  const page = await ctx.newPage();
  const url = `${BASE}/dev/closing-workspace?state=${state}`;
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(500);
  const body = (await page.evaluate(() => document.body?.innerText || "")).replace(/\s+/g, " ");
  // ── Gate-5 invariant assertions (the UI must tell one coherent truth) ──
  const checks = {};
  const hasLivePay = /Authorize this exact live payment/i.test(body);
  const hasApproveBtn = /Approve for signing/i.test(body);
  const sentAlready = /Agreement has already been sent/i.test(body);

  // 1/2 never renders as complete.
  if (state === "partial") {
    checks.partialNotComplete = /Partially signed/i.test(body) && !/2 of 2/.test(body);
    checks.partialAwaitsRemaining = /Awaiting the remaining signer/i.test(body);
    checks.partialNoActions = !hasApproveBtn && !/Authorize sending first/i.test(body);
  }
  // Completed production must NOT show an unverified client, and shows the authorize step.
  if (state === "completed") {
    checks.completedClientVerified = !/not verified|identity not verified/i.test(body);
    checks.livePayShownWhenAuthMissing = hasLivePay;
  }
  // Approved → receipt, no active approve action.
  if (state === "approved") checks.approvedNoApproveButton = /Approved/i.test(body) && !hasApproveBtn;
  // Consumed/sent states never say "Authorize sending first".
  if (["partial","completed","retention_failed","retained","eligible_live","paid"].includes(state)) {
    checks.noReauthorizeCopyWhenSent = !/Authorize sending first/i.test(body);
    checks.saysAlreadySent = sentAlready;
  }
  // Retention failed → enabled retry with the correct next-action copy.
  if (state === "retention_failed") checks.retryOfferedOnFailure = /Retry signed-document retention/i.test(body);
  // Live-payment control absent when not ready for authorization.
  if (["draft","approved","send_authorized","partial","retention_failed","unverified"].includes(state)) checks.noLivePayWhenNotReady = !hasLivePay;
  // Unverified production client is blocked and cannot progress.
  if (state === "unverified") {
    checks.unverifiedBlocked = /Verify client identity|not verified|identity not verified/i.test(body);
    checks.unverifiedNoLivePay = !hasLivePay;
  }
  // No horizontal overflow at any viewport.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  checks.noHorizontalOverflow = !overflow;
  const file = `${OUT}/${state}-${label}.png`;
  await page.screenshot({ path: file, fullPage: true });
  results.push({ state, label, http: resp?.status(), checks, file });
  await ctx.close();
}
for (const s of STATES) { await shot(s, "desktop", { width: 1280, height: 900 }, false); await shot(s, "mobile", { width: 390, height: 844 }, true); }
await browser.close();
console.log(JSON.stringify(results, null, 2));
const failed = results.filter(r => Object.values(r.checks).some(v => v === false));
console.log(failed.length ? `INVARIANT FAILURES: ${failed.length}` : "ALL INVARIANTS OK");

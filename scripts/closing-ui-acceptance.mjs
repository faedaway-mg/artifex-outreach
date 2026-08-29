// Gate 16: desktop + iPhone browser acceptance of the closing workspace dev preview.
// Visits /dev/closing-workspace?state=<S> at 1280x900 and 390x844, screenshots each,
// and asserts key invariants. NO real provider/Stripe — the dev preview is synthetic.
import { chromium, devices } from "playwright";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.HOME + "/acq-os-audit/closing-ui-screenshots";
import fs from "fs";
fs.mkdirSync(OUT, { recursive: true });
const STATES = ["draft", "approved", "send_authorized", "partial", "completed", "retention_failed", "retained", "eligible_live", "paid"];
const browser = await chromium.launch();
const results = [];
async function shot(state, label, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, ...(mobile ? devices["iPhone 13"] : {}), storageState: undefined });
  const page = await ctx.newPage();
  const url = `${BASE}/dev/closing-workspace?state=${state}`;
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(500);
  const body = (await page.evaluate(() => document.body?.innerText || "")).replace(/\s+/g, " ");
  // Invariants
  const checks = {};
  if (state === "partial") checks.partialNotComplete = /Partially signed/i.test(body) && !/2 of 2/.test(body);
  if (["draft","approved","send_authorized","partial","completed"].includes(state)) checks.noLivePayForNonEligible = !/Authorize this exact live payment/i.test(body);
  // horizontal overflow check
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

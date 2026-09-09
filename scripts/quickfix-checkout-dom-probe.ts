// Read-only: open a real TEST Fix Scan checkout and dump its field/iframe structure
// (names/ids/titles + submit testids). No secrets, no charge, no completion.
import { chromium } from "playwright";
import { resolveQuickFixStripeKey } from "../src/lib/quick-fix/stripe-mode";
import { liveStripeCheckoutClient } from "../src/lib/quick-fix/stripe-commerce";
import { buildFixScanCheckoutParams } from "../src/lib/quick-fix/fix-scan-commerce";

async function main() {
  const key = resolveQuickFixStripeKey(process.env, "test");
  if (!key.ok || !key.key) { console.error("no test key"); process.exit(1); }
  const created = await liveStripeCheckoutClient(key.key).create(buildFixScanCheckoutParams({ leadId: "dom-probe", companyName: "DOM Probe", baseUrl: "https://outreach.artifexlabs.tech" }));
  if (!created.url) { console.error("no session url:", created.error); process.exit(1); }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(created.url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({ id: i.id, name: i.getAttribute("name"), type: i.type, ph: i.getAttribute("placeholder"), aria: i.getAttribute("aria-label") }));
    const iframes = Array.from(document.querySelectorAll("iframe")).map((f) => ({ name: f.getAttribute("name"), title: f.getAttribute("title"), src: (f.getAttribute("src") || "").slice(0, 40) }));
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => ({ testid: b.getAttribute("data-testid"), type: b.type, cls: (b.className || "").slice(0, 40), txt: (b.textContent || "").trim().slice(0, 30) }));
    return { inputs, iframes, buttons };
  });
  console.log("URL:", page.url().slice(0, 60));
  console.log("INPUTS:", JSON.stringify(info.inputs, null, 1));
  console.log("IFRAMES:", JSON.stringify(info.iframes, null, 1));
  console.log("BUTTONS:", JSON.stringify(info.buttons.filter((b) => b.testid || b.type === "submit" || /pay/i.test(b.txt)), null, 1));
  await browser.close();
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });

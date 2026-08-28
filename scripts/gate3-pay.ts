// GATE 3 (part B) — CLIENT-FACING browser walkthrough of the REAL Stripe hosted
// invoice page. Opens the hosted URL, screenshots desktop + mobile, pays with a
// Stripe TEST card via the actual page, screenshots the result. Test mode only.
import { chromium } from "playwright";
import path from "path";

const URL = process.argv[2];
const OUT = path.resolve(process.env.HOME!, "acq-os-audit/screenshots");
if (!URL || !/invoice\.stripe\.com/.test(URL)) { console.error("pass a hosted invoice URL"); process.exit(1); }

async function main() {
  const browser = await chromium.launch();
  try {
    // Desktop view
    const dp = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
    await dp.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await dp.waitForTimeout(4000);
    const bodyText = (await dp.textContent("body"))?.replace(/\s+/g, " ").slice(0, 600) ?? "";
    console.log("PAGE TEXT (first 600):", bodyText);
    await dp.screenshot({ path: `${OUT}/hosted-invoice-desktop.png`, fullPage: false });

    // Mobile viewport (NOT a physical device)
    const mp = await browser.newPage({ viewport: { width: 390, height: 1400 } });
    await mp.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await mp.waitForTimeout(1200);
    await mp.screenshot({ path: `${OUT}/hosted-invoice-mobile.png`, fullPage: false });
    await mp.close();

    // The Payment Element is an accordion — select "Card" to reveal the card fields.
    console.log("frames before card-select:", dp.frames().length);
    const cardRow = dp.locator('[class*="Accordion" i], button, [role="button"]').filter({ hasText: /^\s*Card\s*$/ }).first();
    if (await cardRow.count().catch(() => 0)) { await cardRow.click({ force: true }).catch(() => {}); }
    else { await dp.getByText("Card", { exact: true }).first().click({ force: true }).catch(() => {}); }
    await dp.waitForTimeout(3500);
    console.log("frames after card-select:", dp.frames().length);

    // Fill card in the Stripe payment form (card fields live in iframes).
    async function fillCard(): Promise<boolean> {
      const frames = dp.frames();
      for (const f of frames) {
        const num = f.locator('input[name="number"], input[placeholder*="Card number" i]');
        if (await num.count().catch(() => 0)) {
          await num.fill("4242424242424242").catch(() => {});
          await (f.locator('input[name="expiry"], input[placeholder*="MM" i]').first()).fill("12 / 34").catch(() => {});
          await (f.locator('input[name="cvc"], input[placeholder*="CVC" i]').first()).fill("123").catch(() => {});
          const zip = f.locator('input[name="postalCode"], input[placeholder*="ZIP" i], input[placeholder*="Postal" i]').first();
          if (await zip.count().catch(() => 0)) await zip.fill("12345").catch(() => {});
          return true;
        }
      }
      return false;
    }
    // Retry: the payment form can mount after the pay click.
    let filled = false;
    for (let i = 0; i < 8 && !filled; i++) { filled = await fillCard(); if (!filled) await dp.waitForTimeout(1200); }
    console.log("card fields filled:", filled);
    await dp.screenshot({ path: `${OUT}/hosted-invoice-form.png`, fullPage: false });

    if (filled) {
      const submit = dp.getByRole("button", { name: /pay \$|pay now|submit|confirm/i }).first();
      await submit.click().catch(() => {});
      // Wait for success state
      await dp.waitForTimeout(6000);
      const after = (await dp.textContent("body"))?.replace(/\s+/g, " ").slice(0, 400) ?? "";
      console.log("AFTER PAY (first 400):", after);
      await dp.screenshot({ path: `${OUT}/hosted-invoice-paid.png`, fullPage: false });
      console.log("paid-success-text:", /paid|payment received|thank/i.test(after));
    }
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error("PAY WALKTHROUGH ERROR:", e.message); process.exit(1); });

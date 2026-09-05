// UI VISUAL ACCEPTANCE (mandate 15) — authenticated screenshots of the redesigned operator screens at three
// widths, with an automated horizontal-overflow check and an axe accessibility scan. Read-only: navigates
// and screenshots only; never triggers a send/approve/render. Auth via OUTREACH_PASSWORD (inject via
// `railway run --service outreach-web`). Saves PNGs to /tmp/ui-shots and prints overflow + a11y findings.
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.UI_BASE ?? "https://outreach.artifexlabs.tech";
const PW = process.env.OUTREACH_PASSWORD;
const OUT = "/tmp/ui-shots";
mkdirSync(OUT, { recursive: true });

const WIDTHS = [
  { label: "mobile", viewport: { width: 390, height: 844 } },
  { label: "tablet", viewport: { width: 768, height: 1024 } },
  { label: "desktop", viewport: { width: 1440, height: 1000 } },
];
const SCREENS = [
  { key: "today", path: "/" },
  { key: "queue-ready", path: "/queue/ready" },
  { key: "queue-attention", path: "/queue/attention" },
  { key: "queue-scheduled", path: "/queue/scheduled" },
  { key: "queue-replies-empty", path: "/queue/replies" }, // likely-empty → empty-state check
  { key: "content-studio", path: "/content-studio" },
  { key: "activity", path: "/sent" },
];

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]);
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.close();
}

const results = [];
const b = await chromium.launch();
try {
  for (const w of WIDTHS) {
    const ctx = await b.newContext({ viewport: w.viewport, deviceScaleFactor: 2 });
    await login(ctx);
    const p = await ctx.newPage();
    for (const s of SCREENS) {
      try {
        await p.goto(BASE + s.path, { waitUntil: "networkidle", timeout: 30000 });
        await p.waitForTimeout(400);
        const file = `${OUT}/${w.label}-${s.key}.png`;
        await p.screenshot({ path: file });
        const overflow = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
        const horiz = overflow.sw > overflow.iw + 1;
        let a11y = "-";
        if (w.label === "mobile") {
          try { const r = await new AxeBuilder({ page: p }).options({ runOnly: ["wcag2a", "wcag2aa"] }).analyze(); a11y = `${r.violations.length} violations` + (r.violations.length ? ` [${r.violations.slice(0, 4).map((v) => v.id).join(",")}]` : ""); }
          catch { a11y = "axe-failed"; }
        }
        results.push({ w: w.label, screen: s.key, horiz, sw: overflow.sw, iw: overflow.iw, a11y });
        console.log(`${w.label.padEnd(7)} ${s.key.padEnd(22)} overflow=${horiz ? "YES(" + overflow.sw + ">" + overflow.iw + ")" : "no"}  a11y=${a11y}`);
      } catch (e) {
        console.log(`${w.label.padEnd(7)} ${s.key.padEnd(22)} ERROR ${String(e).slice(0, 60)}`);
      }
    }
    await ctx.close();
  }
} finally { await b.close(); }

const overflows = results.filter((r) => r.horiz);
console.log(`\nSHOTS in ${OUT}. Horizontal-overflow screens: ${overflows.length}${overflows.length ? " → " + overflows.map((o) => `${o.w}/${o.screen}`).join(", ") : " (none)"}`);
process.exit(0);

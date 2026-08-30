// Gate 3: axe accessibility audit of the closing workspace across key states, desktop + mobile.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
const BASE = process.env.BASE_URL || "http://localhost:3100";
const STATES = ["draft", "approved", "partial", "completed", "retention_failed", "unverified", "eligible_live"];
const browser = await chromium.launch();
const summary = [];
for (const state of STATES) {
  for (const [label, vp] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dev/closing-workspace?state=${state}`, { waitUntil: "networkidle", timeout: 45000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const bySeverity = {};
    for (const v of results.violations) bySeverity[v.impact] = (bySeverity[v.impact] || 0) + 1;
    const critical = results.violations.filter(v => v.impact === "critical" || v.impact === "serious");
    summary.push({ state, label, total: results.violations.length, bySeverity, criticalSerious: critical.map(v => `${v.id}(${v.impact})`) });
    await ctx.close();
  }
}
await browser.close();
console.log(JSON.stringify(summary, null, 1));
const cs = summary.reduce((n, s) => n + s.criticalSerious.length, 0);
console.log(cs ? `CRITICAL/SERIOUS violations: ${cs}` : "NO CRITICAL/SERIOUS a11y violations");

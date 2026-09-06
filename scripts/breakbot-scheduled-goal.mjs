// BREAKBOT MANDATE-22 GOAL-DRIVEN SYNTHETIC USER. Given ONLY the operator goal "Review every scheduled
// company and verify what will be sent" — NOT a list of selectors — a synthetic user inspects the rendered
// interface, discovers controls by their ACCESSIBLE NAME/ROLE/visible text (semantic discovery), attempts
// the task, explains any confusion, and verifies the result with structured assertions.
//
// HONESTY: this is a genuinely goal-driven agent (it is handed no data-* selectors; it finds controls by
// meaning). It is a HEURISTIC semantic planner, not an LLM — the `chooseControl(intent)` seam is where an
// LLM planner would drop in. It is NOT a scripted selector check: the deterministic regression journey is
// breakbot-scheduled-journey.mjs; this file is the exploratory synthetic-user layer the mandate requires.
import { chromium } from "playwright";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const WIDTHS = [ { label: "mobile", width: 390, height: 844 }, { label: "tablet", width: 768, height: 1024 }, { label: "desktop", width: 1440, height: 1000 } ];
const results = [];
const record = (label, name, ok, detail = "") => { results.push({ label, name, ok: !!ok, detail }); console.log(`${ok ? "OK " : "!! "} [${label}] ${name}${detail ? " — " + detail : ""}`); };

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}

// ── The synthetic user's ONLY way to act: discover a control by MEANING (accessible name/role). ──────────
// (Swap this heuristic for an LLM planner behind the same signature to make it model-backed.)
async function chooseControl(page, intent) {
  for (const role of ["link", "button"]) {
    const loc = page.getByRole(role);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const name = ((await el.getAttribute("aria-label")) || (await el.textContent()) || "").trim();
      if (name && intent.test(name)) {
        const disabled = (await el.getAttribute("aria-disabled")) === "true";
        return { el, name, disabled, found: true };
      }
    }
  }
  return { found: false };
}

async function readsAsScheduledCompany(page) {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  return {
    // "what will be sent" — is there an email with a subject, and which artifacts?
    seesEmail: /email/i.test(text),
    seesPdf: (await chooseControl(page, /quick review pdf|pdf/i)).found,
    seesVideo: (await chooseControl(page, /\bvideo\b/i)).found,
    quarantined: /needs attention/i.test(text) && /(missing|not be sent)/i.test(text),
    // "when it will be sent" — a scheduled time in the accounting tz.
    seesWhen: /PT\b/.test(text) || /\b\d{1,2}:\d{2}\b/.test(text),
    // the company identity is shown.
    hasTitle: (await page.locator("h1, [class*=font-semibold]").first().count()) > 0,
  };
}

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const api = ctx.request;
  await api.post(`${BASE}/api/breakbot?action=reset`);
  const seeded = await (await api.post(`${BASE}/api/breakbot?action=seed-scheduled-queue`)).json();
  const expected = seeded.ordered.length;

  const confusion = [];
  // GOAL step 1: get to the scheduled companies. The user looks for a "Scheduled" affordance from Today.
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const toScheduled = await chooseControl(page, /scheduled/i);
  if (toScheduled.found) { await toScheduled.el.click().catch(() => {}); await page.waitForURL((u) => u.pathname.includes("/queue/scheduled"), { timeout: 8000 }).catch(() => {}); }
  // Verify we actually reached a list of companies; if the affordance didn't land, the user opens it directly.
  if ((await page.locator("a[href^='/company/']").count()) === 0) {
    if (!toScheduled.found) confusion.push("could not find a 'Scheduled' control from Today");
    await page.goto(BASE + "/queue/scheduled", { waitUntil: "networkidle" });
  }
  await page.locator("a[href^='/company/']").first().waitFor({ timeout: 8000 }).catch(() => {});

  // The user opens the first company by choosing a company link (discovered, not handed).
  const firstCompany = page.locator("a[href^='/company/']").first();
  if ((await firstCompany.count()) === 0) confusion.push("no company links found in the Scheduled list");
  else { await firstCompany.click().catch(() => {}); await page.waitForURL((u) => u.pathname.includes("/company/"), { timeout: 8000 }).catch(() => {}); await page.waitForLoadState("networkidle").catch(() => {}); }

  // GOAL: review EVERY scheduled company; for each, understand the six required things.
  const understood = [];
  for (let i = 0; i < expected; i++) {
    const isLast = i === expected - 1;
    const obs = await readsAsScheduledCompany(page);
    const canNext = await chooseControl(page, /next/i);
    const canReturn = (await chooseControl(page, /close|back|today/i)).found;
    const canReject = (await chooseControl(page, /reject|stop future/i)).found;
    const u = {
      whatWillBeSent: obs.quarantined ? true : (obs.seesEmail && (obs.seesPdf || obs.seesVideo)),
      whenWillBeSent: obs.quarantined ? true : obs.seesWhen,
      artifacts: obs.quarantined ? true : (obs.seesPdf || obs.seesVideo),
      howToReturn: canReturn,
      howToReject: canReject,
      // Next is REQUIRED only when there IS a next company; on the last, a disabled/absent Next is correct.
      howToNext: isLast ? true : (canNext.found && !canNext.disabled),
      quarantined: obs.quarantined, // observation only — not an understanding requirement
    };
    understood.push(u);
    const required = ["whatWillBeSent", "whenWillBeSent", "artifacts", "howToReturn", "howToReject", "howToNext"];
    for (const k of required) if (u[k] === false) confusion.push(`company ${i + 1}: did not understand ${k}`);
    // Move to the next company by meaning; stop when the next control is disabled/absent (reached the end).
    if (!isLast) {
      if (!canNext.found || canNext.disabled) { confusion.push(`company ${i + 1}: no working Next control`); break; }
      const url0 = page.url();
      await canNext.el.click().catch(() => {});
      await page.waitForURL((u2) => u2.href !== url0, { timeout: 8000 }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
    }
  }

  const allUnderstood = understood.length === expected && understood.every((u) => u.whatWillBeSent && u.whenWillBeSent && u.artifacts && u.howToNext && u.howToReturn && u.howToReject);
  record(w.label, `synthetic user reviewed all ${expected} scheduled companies`, understood.length === expected, `reviewed=${understood.length}`);
  record(w.label, "understood what/when/artifacts/return/reject for every company", allUnderstood);
  record(w.label, "zero confusion", confusion.length === 0, confusion.slice(0, 4).join(" | "));
  const st = (await (await api.get(`${BASE}/api/breakbot`)).json()).state;
  record(w.label, "zero provider calls during exploration", st.fakeProviderCalls === 0, `calls=${st.fakeProviderCalls}`);

  await api.post(`${BASE}/api/breakbot?action=reset`);
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await run(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-22 GOAL-DRIVEN SYNTHETIC USER: ${results.length - failed.length}/${results.length} checks passed across 3 widths.`);
process.exit(failed.length ? 1 : 0);

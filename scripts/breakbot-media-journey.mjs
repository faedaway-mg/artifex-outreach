// BREAKBOT MANDATE-23 DETERMINISTIC MEDIA JOURNEY. Exercises the repaired Content Studio media workflow at
// 3 widths: canonical operator preview (Close/X + Back + Escape, no dead-end), HASH-VERIFIED download of the
// canonical bytes, canonical artifact equality (operator route == resolver sha), missing-artifact honest
// disable, and the upload→rendering→ready transition through the isolated FAKE render worker. Isolated
// in-memory instance; no real render service; no provider; nothing sent.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const BASE = (process.env.BB_BASE || "http://localhost:3919").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "breakbot-test";
const OUT = "/tmp/bb-media"; mkdirSync(OUT, { recursive: true });
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

async function run(w, browser) {
  const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, deviceScaleFactor: 2 });
  const page = await login(ctx);
  const api = ctx.request;

  // ── READY VIDEO: canonical operator preview + player navigation + hash-verified download ─────────────
  await post(api, "reset");
  const seed = await (await post(api, "seed-approvable")).json();
  const leadId = seed.leadId;
  let ls = await leadState(api, leadId);
  check(w.label, "canonical current video available for a ready package", ls.video.available && !!ls.video.sha256, `src=${ls.video.source}`);
  check(w.label, "operator preview URL is internal (not a /pv recipient share)", (ls.video.operatorPreviewUrl || "").includes("/operator-video/") && !(ls.video.operatorPreviewUrl || "").includes("/pv/"));

  await page.goto(BASE + `/company/${leadId}`, { waitUntil: "networkidle" });
  check(w.label, "Full Package shows a Preview control", (await page.locator("[data-operator-preview-open]").count()) >= 1);
  // open → modal + video; Escape closes
  await page.locator("[data-operator-preview-open]").first().click();
  await page.locator("[data-operator-preview-modal]").first().waitFor({ timeout: 8000 });
  check(w.label, "preview opens a player with a video element", (await page.locator("[data-operator-preview-video]").count()) === 1);
  await page.keyboard.press("Escape");
  await page.locator("[data-operator-preview-modal]").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  check(w.label, "Escape closes the player (no dead-end)", (await page.locator("[data-operator-preview-modal]").count()) === 0);
  // reopen → Close(X) closes
  await page.locator("[data-operator-preview-open]").first().click();
  await page.locator("[data-operator-preview-close]").first().click();
  check(w.label, "Close (X) closes the player", (await page.locator("[data-operator-preview-modal]").count()) === 0);
  // reopen → Back closes
  await page.locator("[data-operator-preview-open]").first().click();
  await page.locator("[data-operator-preview-back]").first().click();
  check(w.label, "Back closes the player", (await page.locator("[data-operator-preview-modal]").count()) === 0);

  // HASH-VERIFIED download: fetch the canonical bytes and verify the sha, not just a button click.
  const dl = await api.get(`${BASE}/api/content-studio/operator-video/${leadId}?download=1`);
  const body = await dl.body();
  const sha = createHash("sha256").update(body).digest("hex");
  const headerSha = dl.headers()["x-artifact-sha256"];
  check(w.label, "downloaded bytes hash matches the canonical artifact sha", sha === ls.video.sha256 && headerSha === ls.video.sha256, `dl=${sha.slice(0, 12)} canon=${(ls.video.sha256 || "").slice(0, 12)}`);
  check(w.label, "download carries a Content-Disposition attachment", /attachment/.test(dl.headers()["content-disposition"] || ""));

  // Canonical equality: the operator stream (inline) resolves the SAME artifact sha as the download.
  const stream = await api.get(`${BASE}/api/content-studio/operator-video/${leadId}`);
  check(w.label, "operator stream + download resolve the SAME canonical artifact", stream.headers()["x-artifact-sha256"] === ls.video.sha256);

  // ── UPLOAD → RENDERING → READY via the isolated fake worker ──────────────────────────────────────────
  await post(api, "reset");
  const nn = await (await post(api, "seed-needs-narration")).json();
  const nId = nn.leadId;
  let s = await leadState(api, nId);
  check(w.label, "needs-narration: no video yet, no render job", s.video.available === false && s.renderJobStatus === null);
  await post(api, "studio-upload", `&leadId=${nId}`);
  s = await leadState(api, nId);
  check(w.label, "after upload: a render job is queued", s.renderJobStatus === "queued");
  await post(api, "studio-advance-render", `&leadId=${nId}`);
  s = await leadState(api, nId);
  check(w.label, "after render completes: job ready + canonical video available", s.renderJobStatus === "ready" && s.video.available === true && !!s.video.sha256);

  // ── MISSING ARTIFACT: honest disable, not a broken player ────────────────────────────────────────────
  await post(api, "reset");
  const seed2 = await (await post(api, "seed-approvable")).json();
  await post(api, "delete-video-artifact", `&leadId=${seed2.leadId}`);
  const s2 = await leadState(api, seed2.leadId);
  check(w.label, "missing artifact → not available with an honest reason", s2.video.available === false && /missing/i.test(s2.video.reason || ""));
  await page.goto(BASE + `/company/${seed2.leadId}`, { waitUntil: "networkidle" });
  check(w.label, "missing artifact → Preview control is not offered as working", (await page.locator("[data-operator-preview-open]").count()) === 0);

  // Isolation.
  const st = await summary(api);
  check(w.label, "ZERO fake-provider calls", st.fakeProviderCalls === 0, `calls=${st.fakeProviderCalls}`);
  await page.screenshot({ path: `${OUT}/${w.label}-media.png` });
  await post(api, "reset");
  await ctx.close();
}

const browser = await chromium.launch();
try { for (const w of WIDTHS) await run(w, browser); } finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
console.log(`\nMANDATE-23 MEDIA JOURNEY: ${results.length - failed.length}/${results.length} checks passed across 3 widths. Screenshots in ${OUT}.`);
process.exit(failed.length ? 1 : 0);

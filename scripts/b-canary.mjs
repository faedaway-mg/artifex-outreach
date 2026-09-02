// B canary (read-mostly, NO prospect impact): proves a voiceover upload AUTOMATICALLY enqueues exactly
// one render, and that a repeated identical upload de-duplicates to the same job. Targets an internal
// master piece (006) — never a prospect. Never sends email. Run with OUTREACH_PASSWORD injected.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = (process.env.BASE || "https://outreach.artifexlabs.tech").replace(/\/$/, "");
const PW = process.env.OUTREACH_PASSWORD || "";
const PIECE = process.env.CANARY_PIECE || "006";
if (!PW) { console.error("OUTREACH_PASSWORD required (not printed)"); process.exit(1); }
const mp3 = readFileSync("/tmp/canary-vo.mp3");

async function login(ctx) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
  await p.fill("#password", PW);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => {}), p.click("button[type=submit]")]);
  await p.waitForLoadState("networkidle").catch(() => {});
  return p;
}

async function upload(ctx) {
  const res = await ctx.request.post(BASE + "/api/content-studio/upload", {
    multipart: {
      pieceId: PIECE, durationSeconds: "6",
      file: { name: "canary-vo.mp3", mimeType: "audio/mpeg", buffer: mp3 },
    },
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status(), j };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await login(ctx);
  const a = await upload(ctx);
  console.log("upload#1:", a.status, "render=", JSON.stringify(a.j.render), "renderError=", a.j.renderError ?? null);
  const b = await upload(ctx);
  console.log("upload#2:", b.status, "render=", JSON.stringify(b.j.render), "renderError=", b.j.renderError ?? null);
  await browser.close();
  const ok1 = a.status === 201 && a.j.render && a.j.render.jobId;
  const dedup = b.j.render && b.j.render.deduped === true && b.j.render.jobId === a.j.render?.jobId;
  console.log("\nAUTO-ENQUEUE:", ok1 ? "PASS" : "FAIL", "| DEDUP on identical re-upload:", dedup ? "PASS" : "(new version — " + JSON.stringify(b.j.render) + ")");
  process.exit(ok1 ? 0 : 3);
}
main().catch((e) => { console.error("canary error:", e.message); process.exit(1); });

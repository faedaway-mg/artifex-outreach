#!/usr/bin/env node
// ARTIFEX — render a data-driven cover PNG from a template's thumbnail spec (bounded art vocabulary).
// Exports renderTemplateThumbnail({ tpl, outPng, thumbDir }) so the render WORKER can generate a cover for
// an operator-authored template (no committed file) and publish it durably. Also a CLI:
//   node scripts/render-template-thumbnail.mjs <id>   (dev: reads the template file, writes the public PNG)
// Injects window.THUMB into the generic thumbnail-template.html and captures a 1080x1920 screenshot.
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Render the cover PNG for `tpl` (needs tpl.thumbnail + tpl.id) into outPng. thumbDir holds the committed
// thumbnail-template.html. Uses a unique debug port + profile dir so it never collides with the frame
// renderer running in the same worker. Container flags come from CHROME_FLAGS (empty on macOS dev).
export async function renderTemplateThumbnail({ tpl, outPng, thumbDir }) {
  const THUMB = { ...tpl.thumbnail, id: tpl.id };
  const TPL_URL = `file://${join(thumbDir, "thumbnail-template.html")}`;
  const PORT = 9500 + (process.pid % 400);
  const EXTRA_FLAGS = (process.env.CHROME_FLAGS || "").split(/\s+/).filter(Boolean);
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cr-tpl-thumb-" + process.pid,
    "--force-device-scale-factor=1", "--window-size=1080,1920", ...EXTRA_FLAGS, "about:blank"], { stdio: "ignore" });
  try {
    let wsUrl = null;
    for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((x) => x.type === "page"); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} }
    if (!wsUrl) throw new Error("no devtools endpoint (thumbnail)");
    const ws = new WebSocket(wsUrl); const pend = new Map(); let sq = 0;
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    const c2 = (method, params = {}) => new Promise((res, rej) => { const idn = ++sq; pend.set(idn, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id: idn, method, params })); });
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    await c2("Page.enable"); await c2("Runtime.enable");
    await c2("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
    await c2("Page.navigate", { url: TPL_URL });
    for (let i = 0; i < 80; i++) { const r = await c2("Runtime.evaluate", { expression: "document.readyState==='complete'&&typeof window.__draw==='function'", returnByValue: true }); if (r.result.value) break; await sleep(80); }
    await c2("Runtime.evaluate", { expression: `window.__draw(${JSON.stringify(THUMB)});true`, returnByValue: true });
    await sleep(400);
    const s = await c2("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 }, captureBeyondViewport: false });
    writeFileSync(outPng, Buffer.from(s.data, "base64"));
    ws.close();
  } finally {
    chrome.kill();
  }
  return outPng;
}

// ── CLI (dev): read the template file, write the committed public PNG + a 4x5 crop ───────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const id = process.argv[2];
  if (!id) { console.error("usage: render-template-thumbnail.mjs <id>"); process.exit(1); }
  const safe = String(id).replace(/[^0-9a-z_-]/gi, "_");
  const tplPath = [join(ROOT, ".data/content-studio/templates", `${safe}.json`), join(ROOT, "public/content/templates", `${safe}.json`)].find(existsSync);
  if (!tplPath) { console.error("template not found for " + id); process.exit(1); }
  const tpl = JSON.parse(readFileSync(tplPath, "utf8"));
  const DIR = join(ROOT, "public", "content", "thumbnails");
  const master = join(DIR, `field-note-${id}-thumbnail.png`);
  await renderTemplateThumbnail({ tpl, outPng: master, thumbDir: DIR });
  execFileSync("ffmpeg", ["-y", "-i", master, "-vf", "crop=1080:1350:0:285", join(DIR, `field-note-${id}-thumbnail-4x5.png`)], { stdio: "ignore" });
  console.log(`thumbnail rendered: ${master}`);
}

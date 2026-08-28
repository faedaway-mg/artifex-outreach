#!/usr/bin/env node
// Render the Artifex content covers from the reusable template (thumbnail.html).
// One 1080×1920 master per cover + a derived 1080×1350 (4:5) center crop. Deterministic.
// Add a cover by adding an entry to COVERS in thumbnail.html — then add its id to IDS below.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "content", "thumbnails");
const TPL = `file://${join(DIR, "thumbnail.html")}`;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9288;
const IDS = ["001", "002", "003", "004", "005", "006"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });
mkdirSync(DIR, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cr-thumbs",
  "--force-device-scale-factor=1", "--window-size=1080,1920", "about:blank"], { stdio: "ignore" });
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((x) => x.type === "page"); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} }
if (!wsUrl) { chrome.kill(); throw new Error("no devtools endpoint"); }
const ws = new WebSocket(wsUrl); const pend = new Map(); let sq = 0;
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const c2 = (method, params = {}) => new Promise((res, rej) => { const id = ++sq; pend.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await c2("Page.enable"); await c2("Runtime.enable");
// Force full 1080x1920 layout viewport so no white backdrop shows at the bottom (root-cause fix).
await c2("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });

for (const id of IDS) {
  await c2("Page.navigate", { url: `${TPL}?c=${id}` });
  // wait for load + art built
  for (let i = 0; i < 80; i++) { const r = await c2("Runtime.evaluate", { expression: "document.readyState==='complete'&&document.getElementById('art').children.length>0&&document.fonts.status==='loaded'", returnByValue: true }); if (r.result.value) break; await sleep(80); }
  await sleep(250);
  const master = join(DIR, `field-note-${id}-thumbnail.png`);
  const s = await c2("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 }, captureBeyondViewport: false });
  writeFileSync(master, Buffer.from(s.data, "base64"));
  // derive 4:5 (1080×1350) center crop from the master (y offset (1920-1350)/2 = 285)
  const c45 = join(DIR, `field-note-${id}-thumbnail-4x5.png`);
  ff(["-i", master, "-vf", "crop=1080:1350:0:285", c45]);
  console.log(`cover ${id}: ${master}  +  ${c45}`);
}
ws.close(); chrome.kill();
console.log("\nAll covers rendered.");

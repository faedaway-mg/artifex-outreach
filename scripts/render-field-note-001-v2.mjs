#!/usr/bin/env node
// Render Content #001 V2 (animated product film) → field-note-001-v2.mp4.
// ONE persistent headless Chrome driven over the DevTools Protocol: for each frame we call the
// page's global render(t) then Page.captureScreenshot (fast, ~50ms), so ~940 frames take ~1–2 min
// instead of cold-launching a browser per frame. Then ffmpeg encodes 24fps + a silent AAC track
// (platform compatibility; the film is fully legible muted). Deterministic + reproducible.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "content", "field-note-001");
const FRAMES = join(ROOT, ".tmp-fn001-frames");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCENE = `file://${join(DIR, "scene.html")}`;
const OUT = join(DIR, "field-note-001-v2.mp4");
const PORT = 9242, FPS = 24, DUR = 39.4;
const N = Math.ceil(DUR * FPS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cr-fn001-cdp",
  "--force-device-scale-factor=1", "--window-size=1080,1920", `${SCENE}?t=0`,
], { stdio: "ignore" });

// Wait for the debug endpoint + find the scene page target.
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) {
  await sleep(150);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find((t) => t.type === "page" && (t.url || "").includes("scene.html"));
    if (page?.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl;
  } catch { /* not up yet */ }
}
if (!wsUrl) { chrome.kill(); throw new Error("Chrome DevTools endpoint never came up"); }

const ws = new WebSocket(wsUrl);
const pending = new Map();
let seq = 0;
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const cmd = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await cmd("Page.enable"); await cmd("Runtime.enable");

// Ensure the scene is loaded and render() is defined.
for (let i = 0; i < 60; i++) {
  const r = await cmd("Runtime.evaluate", { expression: "document.readyState==='complete' && typeof render==='function'", returnByValue: true });
  if (r.result.value === true) break;
  await sleep(100);
}

console.log(`Rendering ${N} frames @ ${FPS}fps (${DUR}s) via one persistent Chrome…`);
for (let i = 0; i < N; i++) {
  const t = (i / FPS).toFixed(4);
  await cmd("Runtime.evaluate", { expression: `render(${t})`, returnByValue: true });
  const shot = await cmd("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 }, captureBeyondViewport: false });
  writeFileSync(join(FRAMES, `f_${String(i).padStart(5, "0")}.png`), Buffer.from(shot.data, "base64"));
  if ((i + 1) % 96 === 0 || i + 1 === N) console.log(`  ${i + 1}/${N}`);
}
ws.close(); chrome.kill();

const got = readdirSync(FRAMES).filter((f) => f.endsWith(".png")).length;
if (got < N) throw new Error(`only ${got}/${N} frames rendered`);

console.log("Encoding MP4…");
execFileSync("ffmpeg", [
  "-y", "-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"),
  "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-shortest", "-movflags", "+faststart", OUT,
], { stdio: "ignore" });
rmSync(FRAMES, { recursive: true, force: true });
console.log(`\nDone: ${OUT}`);

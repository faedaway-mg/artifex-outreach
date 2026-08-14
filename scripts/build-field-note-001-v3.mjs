#!/usr/bin/env node
// Build Content #001 V3 → field-note-001-v3.mp4. Adds an AUTHORIZED on-device synthetic narrator
// (macOS `say`, voice Daniel — NOT a clone of Jordan) synced to the V2 visual backbone, plus two
// restrained sound cues. Pipeline: generate narration segments → measure → compute the visual
// timeline (TL) so events land on the words → build the narration+cues audio → render frames via
// one persistent Chrome (inject TL) → mux. Deterministic. Does NOT overwrite v1/v2.
import { spawn, execFileSync, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "content", "field-note-001");
const TMP = join(ROOT, ".tmp-v3");
const SEG = join(TMP, "seg");
const FRAMES = join(TMP, "frames");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCENE = `file://${join(DIR, "scene-v3.html")}`;
const OUT = join(DIR, "field-note-001-v3.mp4");
const NAR = join(TMP, "narration.wav");
const VOICE = "Daniel", RATE = 172, FPS = 24, PORT = 9243;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dur = (f) => parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "${f}"`).toString().trim());

// Final narration (working script, tightened). Each line drives one visual beat.
const LINES = [
  "We built software to help us find clients.",
  "It worked.",
  "Unfortunately, it got really good at telling us to call strangers.",
  "Which is kind of insane…",
  "because their email addresses were already sitting on their websites.",
  "The software could see them. It just wasn't using them.",
  "So we rebuilt the workflow.",
  "Understand the business, find the right contact, and build them something genuinely useful.",
  "Then ask for their time.",
  "Now the software handles the scale, and humans handle the part that actually needs a human.",
  "That's Artifex Labs.",
];
// silence (s) BEFORE each line: a beat after "It worked", a dramatic freeze after "insane…".
const GAP = [0, 0.30, 0.55, 0.30, 1.05, 0.30, 0.35, 0.28, 0.25, 0.35, 0.35];

rmSync(TMP, { recursive: true, force: true });
mkdirSync(SEG, { recursive: true }); mkdirSync(FRAMES, { recursive: true });

// 1) Generate + measure narration segments.
console.log("Generating narration (say -v Daniel)…");
const segFile = [], start = [], len = [];
LINES.forEach((line, i) => {
  const f = join(SEG, `s${String(i).padStart(2, "0")}.aiff`);
  execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", f, line]);
  segFile.push(f); len.push(dur(f));
});
let cur = 0;
for (let i = 0; i < LINES.length; i++) { cur += GAP[i]; start.push(cur); cur += len[i]; }
const speechEnd = cur;

// 2) Visual timeline (TL) — events land on the words.
const TL = {
  b1: start[0], opt: start[1], calls: start[2], freeze: start[3], site: start[4], reveal: start[5],
  flow: start[6], doc: start[7], send: start[8], principle: start[9], brand: start[10],
  cta: start[10] + len[10] + 0.25, end: 0,
};
TL.end = +(TL.cta + 2.8).toFixed(2);
console.log("TL:", JSON.stringify(TL));

// 3) Sound cues (subtle, original — no licensing risk).
const chime = join(TMP, "chime.wav"), resolve = join(TMP, "resolve.wav");
execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=1046.5:duration=0.18", "-af", "afade=t=out:st=0.07:d=0.11,volume=0.30", chime], { stdio: "ignore" });
execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=196:duration=1.8", "-af", "afade=t=in:d=0.5,afade=t=out:st=1.1:d=0.7,volume=0.22", resolve], { stdio: "ignore" });

// 4) Build the narration+cues track: place each segment/cue at its start via adelay, mix (no normalize).
const inputs = [], filters = [], labels = [];
segFile.forEach((f, i) => { inputs.push("-i", f); const ms = Math.round(start[i] * 1000); filters.push(`[${i}:a]adelay=${ms}|${ms}[a${i}]`); labels.push(`[a${i}]`); });
const ci = segFile.length, ri = segFile.length + 1;
inputs.push("-i", chime, "-i", resolve);
filters.push(`[${ci}:a]adelay=${Math.round(TL.reveal * 1000)}|${Math.round(TL.reveal * 1000)}[ac]`);
filters.push(`[${ri}:a]adelay=${Math.round(TL.principle * 1000)}|${Math.round(TL.principle * 1000)}[ar]`);
labels.push("[ac]", "[ar]");
execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex",
  `${filters.join(";")};${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,apad=whole_dur=${TL.end}[out]`,
  "-map", "[out]", "-ar", "44100", NAR], { stdio: "ignore" });
console.log(`Narration track built (speech ends ~${speechEnd.toFixed(1)}s, video ${TL.end}s).`);

// 5) Render frames via one persistent Chrome (inject TL).
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cr-fn001-v3",
  "--force-device-scale-factor=1", "--window-size=1080,1920", `${SCENE}?t=0`], { stdio: "ignore" });
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((x) => x.type === "page" && (x.url || "").includes("scene-v3.html")); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} }
if (!wsUrl) { chrome.kill(); throw new Error("no devtools endpoint"); }
const ws = new WebSocket(wsUrl); const pend = new Map(); let sq = 0;
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = ++sq; pend.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await cmd("Page.enable"); await cmd("Runtime.enable");
for (let i = 0; i < 60; i++) { const r = await cmd("Runtime.evaluate", { expression: "document.readyState==='complete'&&typeof render==='function'", returnByValue: true }); if (r.result.value) break; await sleep(100); }
await cmd("Runtime.evaluate", { expression: `window.TL=${JSON.stringify(TL)};true`, returnByValue: true });

const N = Math.ceil(TL.end * FPS);
console.log(`Rendering ${N} frames…`);
for (let i = 0; i < N; i++) {
  await cmd("Runtime.evaluate", { expression: `render(${(i / FPS).toFixed(4)})`, returnByValue: true });
  const s = await cmd("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 }, captureBeyondViewport: false });
  writeFileSync(join(FRAMES, `f_${String(i).padStart(5, "0")}.png`), Buffer.from(s.data, "base64"));
  if ((i + 1) % 120 === 0 || i + 1 === N) console.log(`  ${i + 1}/${N}`);
}
ws.close(); chrome.kill();
if (readdirSync(FRAMES).filter((f) => f.endsWith(".png")).length < N) throw new Error("missing frames");

// 6) Mux video + narration.
console.log("Muxing…");
execFileSync("ffmpeg", ["-y", "-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", NAR,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", OUT], { stdio: "ignore" });
rmSync(TMP, { recursive: true, force: true });
console.log(`\nDone: ${OUT}`);

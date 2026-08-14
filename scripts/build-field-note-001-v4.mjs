#!/usr/bin/env node
// Build Content #001 V4 (LinkedIn/Field-Note master) → field-note-001-v4.mp4.
// V3 backbone + living constellation background (scene-v4.html) + a SOUND-DESIGN master with an
// atmospheric bed. NO baked narration — a clean lane is left for Jordan's premium VEED voice.
// Also emits field-note-001-v4-soundbed.wav (stem) and CONTENT-001-V4-NARRATION-TIMING.md.
// Uses macOS `say` ONLY to MEASURE the locked narration so the sound cues + timing sheet land on
// the words; that voice is never mixed into the deliverable. Deterministic. Keeps v1/v2/v3.
import { spawn, execFileSync, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "content", "field-note-001");
const DOCS = join(ROOT, "docs", "content");
const TMP = join(ROOT, ".tmp-v4"), SEG = join(TMP, "seg"), CUE = join(TMP, "cue"), FRAMES = join(TMP, "frames");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCENE = `file://${join(DIR, "scene-v4.html")}`;
const OUT = join(DIR, "field-note-001-v4.mp4");
const BED = join(DIR, "field-note-001-v4-soundbed.wav");
const VOICE = "Daniel", RATE = 172, FPS = 24, PORT = 9244;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dur = (f) => parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "${f}"`).toString().trim());
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });

const LINES = [
  "We built software to help us find clients.", "And it worked.",
  "Unfortunately... it got really good at telling us to call strangers.",
  "Which is kind of insane —", "because their email addresses were already sitting on their websites.",
  "The software could see them. It just wasn't using them.", "So we rebuilt the workflow.",
  "Understand the business. Find the right contact. Build something genuinely useful. Then ask for their time.",
  "Now software handles the scale — and humans handle the part that actually needs a human.",
  "That's Artifex Labs.",
];
const GAP = [0, 0.30, 0.55, 0.35, 0.30, 0.30, 0.35, 0.28, 0.40, 0.35];

rmSync(TMP, { recursive: true, force: true });
[SEG, CUE, FRAMES].forEach((d) => mkdirSync(d, { recursive: true }));

// 1) Measure narration → timeline.
console.log("Measuring narration timing (say)…");
const len = [], start = [];
LINES.forEach((line, i) => { const f = join(SEG, `s${i}.aiff`); execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", f, line]); len.push(dur(f)); });
let cur = 0; for (let i = 0; i < LINES.length; i++) { cur += GAP[i]; start.push(cur); cur += len[i]; }
// TL beats mapped to the 10 narration lines (line 7 is the long rebuild line → doc hero).
const TL = { b1: start[0], opt: start[1], calls: start[2], freeze: start[3], site: start[4], reveal: start[5],
  flow: start[6], doc: start[7], send: start[8], principle: start[8] + len[8] + 0.15, brand: start[9], cta: start[9] + len[9] + 0.25, end: 0 };
TL.principle = start[8]; // "now software handles the scale" line drives the principle
TL.end = +(TL.cta + 2.8).toFixed(2);
console.log("TL:", JSON.stringify(TL));

// 2) Base cue sounds (original, restrained). volume applied per-placement later.
const cue = (name, input, af) => { const f = join(CUE, name + ".wav"); ff(["-f", "lavfi", "-i", input, "-af", af, f]); return f; };
const C = {
  tick: cue("tick", "sine=frequency=1600:duration=0.03", "afade=t=out:st=0.008:d=0.022"),
  activate: cue("activate", "sine=frequency=560:duration=0.14", "afade=t=out:st=0.05:d=0.09"),
  optimized: cue("optimized", "sine=frequency=784:duration=0.20", "afade=t=out:st=0.09:d=0.11"),
  chime: cue("chime", "sine=frequency=1046:duration=0.24", "afade=t=out:st=0.10:d=0.14"),
  scan: cue("scan", "anoisesrc=d=1.8:c=pink", "highpass=f=2500,afade=t=in:d=0.5,afade=t=out:st=1.1:d=0.7"),
  whoosh: cue("whoosh", "anoisesrc=d=0.5:c=pink", "highpass=f=1000,afade=t=in:d=0.15,afade=t=out:st=0.25:d=0.25"),
  rresolve: cue("rresolve", "sine=frequency=294:duration=0.5", "afade=t=out:st=0.2:d=0.3"),
  pulse: cue("pulse", "sine=frequency=360:duration=0.3", "afade=t=out:st=0.12:d=0.18"),
  presolve: cue("presolve", "sine=frequency=196:duration=1.6", "afade=t=in:d=0.5,afade=t=out:st=1.0:d=0.6"),
  brand: cue("brand", "sine=frequency=523:duration=0.6", "afade=t=out:st=0.2:d=0.4"),
};
// Atmospheric bed (low drone + faint air) — sub/low so it never occupies the VO midrange.
const atmo = join(CUE, "atmo.wav");
ff(["-f", "lavfi", "-i", `sine=frequency=72:duration=${TL.end}`, "-f", "lavfi", "-i", `sine=frequency=108:duration=${TL.end}`,
  "-f", "lavfi", "-i", `anoisesrc=d=${TL.end}:c=pink`,
  "-filter_complex", "[0:a]volume=0.5[a];[1:a]volume=0.32[b];[2:a]highpass=f=6500,volume=0.09[c];[a][b][c]amix=inputs=3:normalize=0,lowpass=f=9000,volume=0.5[o]",
  "-map", "[o]", atmo]);

// 3) Placements (time, base, volume). Cues land on story events; CALL ticks accelerate.
const P = [{ f: atmo, at: 0, v: 1.0 }];
P.push({ f: C.activate, at: TL.b1 + 0.15, v: 0.16 });
P.push({ f: C.optimized, at: TL.opt, v: 0.24 });
const step = (TL.freeze - TL.calls - 0.2) / 8;
for (let i = 0; i < 8; i++) P.push({ f: C.tick, at: TL.calls + 0.2 + i * step, v: 0.10 + 0.10 * (i / 7) });
P.push({ f: C.scan, at: TL.site + 0.6, v: 0.10 });
P.push({ f: C.chime, at: TL.reveal, v: 0.30 });                              // discovery "oh"
[0, 1.4, 2.6, 3.8].forEach((d) => P.push({ f: C.tick, at: TL.doc + d, v: 0.14 })); // Review construction
P.push({ f: C.rresolve, at: TL.doc + (TL.send - TL.doc) * 0.85, v: 0.20 });  // Review complete
P.push({ f: C.whoosh, at: TL.send, v: 0.12 });                              // into send
P.push({ f: C.optimized, at: TL.send + 1.0, v: 0.18 });                     // value first ✓
P.push({ f: C.pulse, at: TL.send + 2.4, v: 0.16 });                         // warm follow-up
P.push({ f: C.presolve, at: TL.principle, v: 0.22 });                       // calm resolve
P.push({ f: C.brand, at: TL.cta, v: 0.18 });                                // subtle brand sonic

// 4) Mix the sound-design master (no narration). Peaks kept low → clear VO headroom.
const ins = [], filt = [], lab = [];
P.forEach((p, k) => { ins.push("-i", p.f); const ms = Math.max(0, Math.round(p.at * 1000)); filt.push(`[${k}:a]adelay=${ms}|${ms},volume=${p.v}[a${k}]`); lab.push(`[a${k}]`); });
ff([...ins, "-filter_complex", `${filt.join(";")};${lab.join("")}amix=inputs=${lab.length}:normalize=0:duration=longest,apad=whole_dur=${TL.end},volume=0.55,alimiter=limit=0.55[out]`, "-map", "[out]", "-ar", "44100", BED]);
const md = execSync(`ffmpeg -i "${BED}" -af volumedetect -f null - 2>&1 | grep -E "max_volume" || true`).toString().trim();
console.log("Soundbed built. " + md + " (headroom for VO)");

// 5) Render frames (scene-v4 with the living background) via one persistent Chrome; inject TL.
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cr-fn001-v4",
  "--force-device-scale-factor=1", "--window-size=1080,1920", `${SCENE}?t=0`], { stdio: "ignore" });
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((x) => x.type === "page" && (x.url || "").includes("scene-v4.html")); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} }
if (!wsUrl) { chrome.kill(); throw new Error("no devtools endpoint"); }
const ws = new WebSocket(wsUrl); const pend = new Map(); let sq = 0;
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const c2 = (method, params = {}) => new Promise((res, rej) => { const id = ++sq; pend.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await c2("Page.enable"); await c2("Runtime.enable");
for (let i = 0; i < 60; i++) { const r = await c2("Runtime.evaluate", { expression: "document.readyState==='complete'&&typeof render==='function'", returnByValue: true }); if (r.result.value) break; await sleep(100); }
await c2("Runtime.evaluate", { expression: `window.TL=${JSON.stringify(TL)};true`, returnByValue: true });
const N = Math.ceil(TL.end * FPS);
console.log(`Rendering ${N} frames (living background)…`);
for (let i = 0; i < N; i++) {
  await c2("Runtime.evaluate", { expression: `render(${(i / FPS).toFixed(4)})`, returnByValue: true });
  const s = await c2("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 }, captureBeyondViewport: false });
  writeFileSync(join(FRAMES, `f_${String(i).padStart(5, "0")}.png`), Buffer.from(s.data, "base64"));
  if ((i + 1) % 120 === 0 || i + 1 === N) console.log(`  ${i + 1}/${N}`);
}
ws.close(); chrome.kill();
if (readdirSync(FRAMES).filter((f) => f.endsWith(".png")).length < N) throw new Error("missing frames");

// 6) Mux video + sound-design master (NO narration).
console.log("Muxing V4 (no narration)…");
ff(["-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", BED,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT]);

// 7) Narration timing sheet for VEED.
const fmt = (s) => { const m = Math.floor(s / 60), r = (s % 60).toFixed(1).padStart(4, "0"); return `${String(m).padStart(2, "0")}:${r}`; };
let sheet = `# Content #001 V4 — Narration Timing Sheet (for VEED)\n\nPaste this narration into VEED, pick a premium voice, and align each line to the window below.\nThe V4 sound design + visual events already land on these words. Video is 1080×1920, ${TL.end}s, faceless.\n\n| # | Start–End | Line |\n| - | --------- | ---- |\n`;
LINES.forEach((l, i) => { sheet += `| ${i + 1} | ${fmt(start[i])}–${fmt(start[i] + len[i])} | ${l} |\n`; });
sheet += `\n**Do not clone Jordan's voice.** Use an authorized premium/company voice. Leave the sound bed\nunderneath; it is low/sub-range and mixed to sit below a normal speaking voice.\n`;
writeFileSync(join(DOCS, "CONTENT-001-V4-NARRATION-TIMING.md"), sheet);

rmSync(TMP, { recursive: true, force: true });
console.log(`\nDone:\n  ${OUT}\n  ${BED}\n  ${join(DOCS, "CONTENT-001-V4-NARRATION-TIMING.md")}`);

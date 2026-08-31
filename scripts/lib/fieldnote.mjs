// ARTIFEX FIELD NOTES — shared build library (the "content factory" backend).
// One tonal audio palette (NO noise generators — learned from the #001 V4 cleanup), one deterministic
// Chrome frame renderer, one mux (full + silent-for-VEED), one narration-timing writer. Each
// build-field-note-00X.mjs just declares its timeline, cue placements, and narration.
import { spawn, execFileSync, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// CHROME_PATH lets the identical renderer run on Linux/Railway (Chromium in the worker image); falls
// back to the macOS Chrome for local dev.
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FPS = 24;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const dur = (f) => parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "${f}"`).toString().trim());
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });

// Standard TONAL cue palette (sine + aevalsrc glides). Returns {C, atmo}. endSec sizes the drone.
export function buildPalette(CUE, endSec) {
  const cue = (name, input, af) => { const f = join(CUE, name + ".wav"); ff(["-f", "lavfi", "-i", input, "-af", af, f]); return f; };
  const C = {
    tick: cue("tick", "sine=frequency=1600:duration=0.03", "afade=t=out:st=0.008:d=0.022"),
    celllock: cue("celllock", "sine=frequency=900:duration=0.08", "afade=t=out:st=0.03:d=0.05"),
    crmtick: cue("crmtick", "sine=frequency=680:duration=0.13", "afade=t=out:st=0.05:d=0.08"),
    activate: cue("activate", "sine=frequency=560:duration=0.14", "afade=t=out:st=0.05:d=0.09"),
    confirm: cue("confirm", "sine=frequency=784:duration=0.22", "afade=t=out:st=0.10:d=0.12"),
    chime: cue("chime", "sine=frequency=1046:duration=0.26", "afade=t=out:st=0.11:d=0.15"),
    low: cue("low", "sine=frequency=294:duration=0.5", "afade=t=out:st=0.2:d=0.3"),
    unresolved: cue("unresolved", "sine=frequency=392:duration=0.6", "afade=t=in:d=0.1,afade=t=out:st=0.28:d=0.32"),
    pulse: cue("pulse", "sine=frequency=360:duration=0.3", "afade=t=out:st=0.12:d=0.18"),
    presolve: cue("presolve", "sine=frequency=196:duration=1.8", "afade=t=in:d=0.6,afade=t=out:st=1.1:d=0.7"),
    brand: cue("brand", "sine=frequency=261.6:duration=0.9", "afade=t=out:st=0.3:d=0.6"),
    connect: cue("connect", "aevalsrc=0.5*sin(2*PI*(300*t+300*t*t)):d=0.7:s=44100", "lowpass=f=3000,afade=t=in:d=0.12,afade=t=out:st=0.45:d=0.25"),
    glide: cue("glide", "aevalsrc=0.5*sin(2*PI*(560*t-150*t*t)):d=0.6:s=44100", "lowpass=f=2800,afade=t=in:d=0.12,afade=t=out:st=0.35:d=0.25"),
    descend: cue("descend", "aevalsrc=0.5*sin(2*PI*(440*t-120*t*t)):d=0.65:s=44100", "lowpass=f=2600,afade=t=in:d=0.12,afade=t=out:st=0.4:d=0.25"),
  };
  const atmo = join(CUE, "atmo.wav");
  ff(["-f", "lavfi", "-i", `sine=frequency=72:duration=${endSec}`, "-f", "lavfi", "-i", `sine=frequency=108:duration=${endSec}`,
    "-filter_complex", "[0:a]volume=0.5[a];[1:a]volume=0.34[b];[a][b]amix=inputs=2:normalize=0,lowpass=f=220,volume=0.6[o]",
    "-map", "[o]", atmo]);
  C.atmo = atmo;
  return C;
}

// Mix placements [{f, at, v}] → clean master WAV. Low peaks → VO headroom. Returns max_volume string.
export function mixBed(placements, endSec, outWav) {
  const ins = [], filt = [], lab = [];
  placements.forEach((p, k) => { ins.push("-i", p.f); const ms = Math.max(0, Math.round(p.at * 1000)); filt.push(`[${k}:a]adelay=${ms}|${ms},volume=${p.v}[a${k}]`); lab.push(`[a${k}]`); });
  ff([...ins, "-filter_complex", `${filt.join(";")};${lab.join("")}amix=inputs=${lab.length}:normalize=0:duration=longest,apad=whole_dur=${endSec},volume=0.62,alimiter=limit=0.7[out]`, "-map", "[out]", "-ar", "44100", outWav]);
  return execSync(`ffmpeg -i "${outWav}" -af volumedetect -f null - 2>&1 | grep -E "max_volume" || true`).toString().trim();
}

// Render every frame of sceneFile (injecting window.TL) via one persistent headless Chrome.
export async function renderFrames({ sceneFile, sceneBasename, TL, port, framesDir, onProgress, globals }) {
  rmSync(framesDir, { recursive: true, force: true }); mkdirSync(framesDir, { recursive: true });
  const SCENE = `file://${sceneFile}`;
  // Container launch flags (e.g. --no-sandbox --disable-dev-shm-usage) come from CHROME_FLAGS — empty on
  // local macOS dev so behavior there is unchanged; Chromium under root in a container needs --no-sandbox.
  const EXTRA_FLAGS = (process.env.CHROME_FLAGS || "").split(/\s+/).filter(Boolean);
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${port}`, "--user-data-dir=/tmp/cr-" + sceneBasename,
    "--force-device-scale-factor=1", "--window-size=1080,1920", ...EXTRA_FLAGS, `${SCENE}?t=0`], { stdio: "ignore" });
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = l.find((x) => x.type === "page" && (x.url || "").includes(sceneBasename)); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} }
  if (!wsUrl) { chrome.kill(); throw new Error("no devtools endpoint"); }
  const ws = new WebSocket(wsUrl); const pend = new Map(); let sq = 0;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const c2 = (method, params = {}) => new Promise((res, rej) => { const id = ++sq; pend.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await c2("Page.enable"); await c2("Runtime.enable");
  // Force the layout viewport to the FULL 1080x1920 so no un-painted white backdrop shows at the
  // bottom (headless --window-size left the viewport ~87px short → a white strip). Root-cause fix.
  await c2("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 60; i++) { const r = await c2("Runtime.evaluate", { expression: "document.readyState==='complete'&&typeof render==='function'", returnByValue: true }); if (r.result.value) break; await sleep(100); }
  // Inject any extra globals (e.g. window.TEMPLATE for the data-driven renderer) BEFORE window.TL, so a
  // scene that lazily builds on first render() sees its data. Values are JSON — never executed as code.
  if (globals) for (const [k, v] of Object.entries(globals)) await c2("Runtime.evaluate", { expression: `window[${JSON.stringify(k)}]=${JSON.stringify(v)};true`, returnByValue: true });
  await c2("Runtime.evaluate", { expression: `window.TL=${JSON.stringify(TL)};true`, returnByValue: true });
  const N = Math.ceil(TL.end * FPS);
  console.log(`Rendering ${N} frames…`);
  for (let i = 0; i < N; i++) {
    await c2("Runtime.evaluate", { expression: `render(${(i / FPS).toFixed(4)})`, returnByValue: true });
    const s = await c2("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 }, captureBeyondViewport: false });
    writeFileSync(join(framesDir, `f_${String(i).padStart(5, "0")}.png`), Buffer.from(s.data, "base64"));
    if ((i + 1) % 120 === 0 || i + 1 === N) console.log(`  ${i + 1}/${N}`);
    if (onProgress && ((i + 1) % 24 === 0 || i + 1 === N)) { try { onProgress(i + 1, N); } catch {} }
  }
  ws.close(); chrome.kill();
  if (readdirSync(framesDir).filter((f) => f.endsWith(".png")).length < N) throw new Error("missing frames");
}

// THUMBNAIL-FIRST: overwrite the first rendered frame with the piece's generated cover so the FIRST
// DECODED video frame IS the thumbnail — real encoded content, not a poster/metadata. No added time,
// no audio shift, no multi-second hold (only frame 0 changes). Frame 0 is the opening keyframe, so it
// survives libx264 encoding within tolerance. Cover is forced to exact 1080×1920 (full-height
// vertical — no stretch of a 4:5 crop, no letterbox).
export function embedThumbnailFrameZero({ framesDir, thumbPath }) {
  const f0 = join(framesDir, "f_00000.png");
  if (!existsSync(thumbPath)) throw new Error("thumbnail not found: " + thumbPath);
  ff(["-i", thumbPath, "-vf", "scale=1080:1920:flags=lanczos", "-frames:v", "1", f0]);
  return f0;
}

// Mux frames+bed → OUT, then a silent copy (same video stream) → SILENT.
export function muxOutputs({ framesDir, bed, out, silent }) {
  ff(["-framerate", String(FPS), "-i", join(framesDir, "f_%05d.png"), "-i", bed,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  ff(["-i", out, "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", silent]);
}

export function writeTiming(docPath, note, endSec, lines, anchors, silentName) {
  const fmt = (s) => { const m = Math.floor(s / 60), r = (s % 60).toFixed(1).padStart(4, "0"); return `${String(m).padStart(2, "0")}:${r}`; };
  let sheet = `# Content #${note} — Narration Timing Sheet (for VEED)\n\nPaste narration into VEED, pick a premium voice, align each line near the anchor below.\nThe sound design + visual beats already land here. Video is 1080×1920, ${endSec}s, faceless.\nUse **${silentName}** to add your own music too, or narrate over the full mp4 (the clean bed sits\nbelow a normal speaking voice). Target spoken length ≈ 30–32s at natural pace.\n\n| # | ~Anchor | Line |\n| - | ------- | ---- |\n`;
  lines.forEach((l, i) => { sheet += `| ${i + 1} | ${fmt(anchors[i])} | ${l} |\n`; });
  sheet += `\n**Do not clone Jordan's voice.** Use an authorized premium/company voice. Leave substantial midrange headroom.\n`;
  writeFileSync(docPath, sheet);
}

// ── VO FINISHING helpers (used by finish-field-note-vo.mjs) ──
// Parse a VO's speech-segment start times + last-speech-end from silencedetect.
export function readSpeech(voPath) {
  const out = execSync(`ffmpeg -i "${voPath}" -af "silencedetect=noise=-33dB:d=0.28" -f null - 2>&1 || true`).toString();
  const voDur = dur(voPath);
  const starts = [], ends = [];
  out.split("\n").forEach((l) => { let m; if ((m = l.match(/silence_start:\s*([\d.]+)/))) starts.push(parseFloat(m[1])); if ((m = l.match(/silence_end:\s*([\d.]+)/))) ends.push(parseFloat(m[1])); });
  const onset = (starts.length && starts[0] < 0.2) ? ends[0] : 0.05;      // leading silence?
  const speechStarts = [onset, ...ends.filter((e) => e < voDur - 0.25)];  // resume points (drop EOF)
  speechStarts.sort((a, b) => a - b);
  // last spoken moment = last silence_start after the final speech start, else file end
  const lastStart = speechStarts[speechStarts.length - 1];
  const trailing = starts.filter((s) => s > lastStart);
  const speechEnd = trailing.length ? Math.max(...trailing) : voDur;
  return { voDur, speechStarts, speechEnd };
}

// Sample a monotonic array at a fractional index (linear interpolation).
function interp(arr, pos) { const i = Math.max(0, Math.min(arr.length - 1, Math.floor(pos))); const f = pos - i; return i + 1 < arr.length ? arr[i] + f * (arr[i + 1] - arr[i]) : arr[i]; }

// Warp a base timeline to the VO: map each narration line's base time → a VO speech onset, then
// piecewise-linear interpolate every TL key through those anchors. brand/end land after the voice.
export function warpTimeline(baseTL, narrTimes, speech, tail = { brand: 0.5, hold: 2.3 }) {
  const S = speech.speechStarts, L = narrTimes.length;
  const WT = narrTimes.map((_, i) => interp(S, i * (S.length - 1) / (L - 1)));
  const NT = narrTimes;
  const warp = (x) => {
    if (x <= NT[0]) return Math.max(0.05, WT[0] + (x - NT[0]) * (WT[1] - WT[0]) / (NT[1] - NT[0]));
    for (let j = 0; j < L - 1; j++) if (x <= NT[j + 1]) return WT[j] + (x - NT[j]) * (WT[j + 1] - WT[j]) / ((NT[j + 1] - NT[j]) || 1e-6);
    return WT[L - 1] + (x - NT[L - 1]) * (WT[L - 1] - WT[L - 2]) / ((NT[L - 1] - NT[L - 2]) || 1e-6);
  };
  const newTL = {}; for (const k of Object.keys(baseTL)) newTL[k] = +warp(baseTL[k]).toFixed(3);
  newTL.brand = +(speech.speechEnd + tail.brand).toFixed(3);
  newTL.end = +(newTL.brand + tail.hold).toFixed(3);
  return newTL;
}

// VO mp3 → clean 44.1k mono WAV stem.
export function voToWav(voPath, outWav) { ff(["-i", voPath, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", outWav]); }

// Mix VOICE (dominant) + CUE stem (gently ducked under speech). No bed. Gentle social master.
export function mixVoiceCues({ voWav, cuesWav, endSec, outWav }) {
  ff(["-i", voWav, "-i", cuesWav, "-filter_complex",
    `[0:a]apad=whole_dur=${endSec},volume=1.0,asplit=2[vo][vk];` +
    `[1:a]apad=whole_dur=${endSec}[cu];` +
    `[cu][vk]sidechaincompress=threshold=0.1:ratio=3:attack=8:release=300[cud];` +
    `[vo][cud]amix=inputs=2:normalize=0:duration=longest[mx];` +
    `[mx]loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.97[out]`,
    "-map", "[out]", "-ar", "44100", outWav]);
  return execSync(`ffmpeg -i "${outWav}" -af volumedetect -f null - 2>&1 | grep -E "max_volume|mean_volume" || true`).toString().trim().replace(/\n/g, " | ");
}

// Full pipeline for one field note.
export async function buildFieldNote(cfg) {
  const { dir, docs, tmp, sceneFile, sceneBasename, note, port, TL, placements, narration } = cfg;
  const CUE = join(tmp, "cue"), FRAMES = join(tmp, "frames");
  rmSync(tmp, { recursive: true, force: true }); [CUE, FRAMES].forEach((d) => mkdirSync(d, { recursive: true }));
  const OUT = join(dir, `field-note-${note}.mp4`), SILENT = join(dir, `field-note-${note}-silent.mp4`), BED = join(dir, `field-note-${note}-soundbed.wav`);
  const C = buildPalette(CUE, TL.end);
  const P = placements(C, TL);
  const md = mixBed(P, TL.end, BED);
  console.log("Soundbed built. " + md + " (headroom for VO)");
  await renderFrames({ sceneFile, sceneBasename, TL, port, framesDir: FRAMES });
  // Thumbnail-first: frame zero becomes the generated cover (default path derives from the note).
  const thumbPath = cfg.thumbPath || join(dir, "..", "thumbnails", `field-note-${note}-thumbnail.png`);
  if (existsSync(thumbPath)) { embedThumbnailFrameZero({ framesDir: FRAMES, thumbPath }); console.log("Thumbnail embedded as frame zero: " + thumbPath); }
  else console.log("WARNING: no thumbnail at " + thumbPath + " — frame zero left as rendered scene open.");
  console.log("Muxing…");
  muxOutputs({ framesDir: FRAMES, bed: BED, out: OUT, silent: SILENT });
  mkdirSync(docs, { recursive: true });
  writeTiming(join(docs, `CONTENT-${note}-NARRATION-TIMING.md`), note, TL.end, narration.lines, narration.anchors, `field-note-${note}-silent.mp4`);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\nDone:\n  ${OUT}\n  ${SILENT}\n  ${BED}\n  ${join(docs, `CONTENT-${note}-NARRATION-TIMING.md`)}`);
}

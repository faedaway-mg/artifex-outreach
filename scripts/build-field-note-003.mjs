#!/usr/bin/env node
// Build Content #003 (Artifex Labs field note) → field-note-003.mp4.
// Story: a valuable lead arrives → somebody sees it → nobody owns the next step → time passes →
// it goes cold; then Artifex assigns owner + next action + follow-up and CLOSES THE LOOP.
// Same visual family as #001/#002 (scene-003.html). Audio is 100% TONAL (sine + aevalsrc glides) —
// NO noise generators. NO baked narration. Emits full + silent (for VEED) + stem + timing sheet.
import { spawn, execFileSync, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "content", "field-note-003");
const DOCS = join(ROOT, "docs", "content");
const TMP = join(ROOT, ".tmp-003"), CUE = join(TMP, "cue"), FRAMES = join(TMP, "frames");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCENE = `file://${join(DIR, "scene-003.html")}`;
const OUT = join(DIR, "field-note-003.mp4");
const SILENT = join(DIR, "field-note-003-silent.mp4");
const BED = join(DIR, "field-note-003-soundbed.wav");
const FPS = 24, PORT = 9277;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dur = (f) => parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "${f}"`).toString().trim());
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });

// Storyboard timeline (matches scene-003.html defaults → cues + visuals share one clock).
const TL = { inq: 0.3, recv: 2.8, viewed: 4.4, unassigned: 5.6, saw: 6.4, lanes: 8.4, drift: 9.0, noowner: 11.6,
  times: 13.4, nofollow: 14.6, didnt: 15.8, stopped: 17.0, cold: 18.4, lost: 19.8, turn: 21.6, struct: 22.4,
  owner: 24.2, action: 26.2, loop: 27.4, memory: 29.6, brand: 31.4, end: 33.6 };

rmSync(TMP, { recursive: true, force: true });
[CUE, FRAMES].forEach((d) => mkdirSync(d, { recursive: true }));

// ── 1) TONAL cue palette (no noise) ──
const cue = (name, input, af) => { const f = join(CUE, name + ".wav"); ff(["-f", "lavfi", "-i", input, "-af", af, f]); return f; };
const C = {
  tick: cue("tick", "sine=frequency=1600:duration=0.03", "afade=t=out:st=0.008:d=0.022"),
  celllock: cue("celllock", "sine=frequency=900:duration=0.08", "afade=t=out:st=0.03:d=0.05"),
  activate: cue("activate", "sine=frequency=560:duration=0.14", "afade=t=out:st=0.05:d=0.09"),      // owner assigned
  confirm: cue("confirm", "sine=frequency=784:duration=0.22", "afade=t=out:st=0.10:d=0.12"),         // follow-up complete
  chime: cue("chime", "sine=frequency=1046:duration=0.26", "afade=t=out:st=0.11:d=0.15"),            // inquiry arrival
  low: cue("low", "sine=frequency=294:duration=0.5", "afade=t=out:st=0.2:d=0.3"),
  unresolved: cue("unresolved", "sine=frequency=392:duration=0.6", "afade=t=in:d=0.1,afade=t=out:st=0.28:d=0.32"), // unassigned (hangs)
  pulse: cue("pulse", "sine=frequency=360:duration=0.3", "afade=t=out:st=0.12:d=0.18"),
  presolve: cue("presolve", "sine=frequency=196:duration=1.8", "afade=t=in:d=0.6,afade=t=out:st=1.1:d=0.7"),
  brand: cue("brand", "sine=frequency=261.6:duration=0.9", "afade=t=out:st=0.3:d=0.6"),
  // rising tonal glide — Artifex connection / closed loop
  connect: cue("connect", "aevalsrc=0.5*sin(2*PI*(300*t+300*t*t)):d=0.7:s=44100", "lowpass=f=3000,afade=t=in:d=0.12,afade=t=out:st=0.45:d=0.25"),
  // falling tonal glide — recognition ("workflow stopped") + lead going cold
  descend: cue("descend", "aevalsrc=0.5*sin(2*PI*(440*t-120*t*t)):d=0.65:s=44100", "lowpass=f=2600,afade=t=in:d=0.12,afade=t=out:st=0.4:d=0.25"),
};
// clean low drone bed
const atmo = join(CUE, "atmo.wav");
ff(["-f", "lavfi", "-i", `sine=frequency=72:duration=${TL.end}`, "-f", "lavfi", "-i", `sine=frequency=108:duration=${TL.end}`,
  "-filter_complex", "[0:a]volume=0.5[a];[1:a]volume=0.34[b];[a][b]amix=inputs=2:normalize=0,lowpass=f=220,volume=0.6[o]",
  "-map", "[o]", atmo]);

// ── 2) Cue placements on STORY BEATS ──
const P = [{ f: atmo, at: 0, v: 1.0 }];
P.push({ f: C.chime, at: TL.inq + 0.4, v: 0.24 });                       // inquiry arrival (positive)
P.push({ f: C.low, at: TL.recv, v: 0.12 });                              // received · 9:14
P.push({ f: C.tick, at: TL.viewed + 0.1, v: 0.12 });                     // opened (micro tick)
P.push({ f: C.unresolved, at: TL.unassigned, v: 0.13 });                 // unassigned (hangs, unresolved)
[0, 0.25, 0.5].forEach((d) => P.push({ f: C.tick, at: TL.lanes + 0.3 + d, v: 0.07 })); // lanes appear (faint)
P.push({ f: C.low, at: TL.noowner, v: 0.11 });                           // "nobody owned the next step"
[0.2, 0.9, 1.6].forEach((d) => P.push({ f: C.tick, at: TL.times + d, v: 0.09 })); // time advances (minimal ticks)
P.push({ f: C.descend, at: TL.stopped, v: 0.15 });                       // "the workflow stopped" (recognition)
P.push({ f: C.descend, at: TL.cold + 0.2, v: 0.13 });                    // lead goes cold (subtle descend)
P.push({ f: C.low, at: TL.lost, v: 0.10 });                              // lost quietly
P.push({ f: C.connect, at: TL.turn + 0.4, v: 0.18 });                    // Artifex re-arrives / structure
P.push({ f: C.activate, at: TL.struct + 0.5, v: 0.18 });                 // OWNER assigned (tactile)
P.push({ f: C.celllock, at: TL.struct + 1.5, v: 0.14 });                 // NEXT ACTION lock
P.push({ f: C.celllock, at: TL.struct + 2.0, v: 0.12 });                 // DUE set
P.push({ f: C.confirm, at: TL.struct + 2.8, v: 0.20 });                  // FOLLOW-UP COMPLETE (satisfying)
P.push({ f: C.pulse, at: TL.owner, v: 0.14 });                           // "every opportunity needs an owner"
// closed loop — a warm pulse travels the chain (5 soft ticks) + a connecting glide
for (let i = 0; i < 5; i++) P.push({ f: C.celllock, at: TL.loop + 0.5 + i * 0.4, v: 0.09 });
P.push({ f: C.connect, at: TL.loop + 0.5, v: 0.14 });                    // closed-loop connected pulse
P.push({ f: C.presolve, at: TL.memory, v: 0.16 });                       // calm pad under resolve
P.push({ f: C.brand, at: TL.brand + 0.2, v: 0.22 });                     // warm low brand resolve

// ── 3) Mix CLEAN sound-design master (no narration) ──
const ins = [], filt = [], lab = [];
P.forEach((p, k) => { ins.push("-i", p.f); const ms = Math.max(0, Math.round(p.at * 1000)); filt.push(`[${k}:a]adelay=${ms}|${ms},volume=${p.v}[a${k}]`); lab.push(`[a${k}]`); });
ff([...ins, "-filter_complex", `${filt.join(";")};${lab.join("")}amix=inputs=${lab.length}:normalize=0:duration=longest,apad=whole_dur=${TL.end},volume=0.62,alimiter=limit=0.7[out]`, "-map", "[out]", "-ar", "44100", BED]);
const md = execSync(`ffmpeg -i "${BED}" -af volumedetect -f null - 2>&1 | grep -E "max_volume" || true`).toString().trim();
console.log("Soundbed built. " + md + " (headroom for VO)");

// ── 4) Render frames via persistent Chrome; inject TL ──
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cr-fn003",
  "--force-device-scale-factor=1", "--window-size=1080,1920", `${SCENE}?t=0`], { stdio: "ignore" });
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((x) => x.type === "page" && (x.url || "").includes("scene-003.html")); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} }
if (!wsUrl) { chrome.kill(); throw new Error("no devtools endpoint"); }
const ws = new WebSocket(wsUrl); const pend = new Map(); let sq = 0;
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const c2 = (method, params = {}) => new Promise((res, rej) => { const id = ++sq; pend.set(id, (m) => m.error ? rej(new Error(m.error.message)) : res(m.result)); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
await c2("Page.enable"); await c2("Runtime.enable");
for (let i = 0; i < 60; i++) { const r = await c2("Runtime.evaluate", { expression: "document.readyState==='complete'&&typeof render==='function'", returnByValue: true }); if (r.result.value) break; await sleep(100); }
await c2("Runtime.evaluate", { expression: `window.TL=${JSON.stringify(TL)};true`, returnByValue: true });
const N = Math.ceil(TL.end * FPS);
console.log(`Rendering ${N} frames…`);
for (let i = 0; i < N; i++) {
  await c2("Runtime.evaluate", { expression: `render(${(i / FPS).toFixed(4)})`, returnByValue: true });
  const s = await c2("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 }, captureBeyondViewport: false });
  writeFileSync(join(FRAMES, `f_${String(i).padStart(5, "0")}.png`), Buffer.from(s.data, "base64"));
  if ((i + 1) % 120 === 0 || i + 1 === N) console.log(`  ${i + 1}/${N}`);
}
ws.close(); chrome.kill();
if (readdirSync(FRAMES).filter((f) => f.endsWith(".png")).length < N) throw new Error("missing frames");

// ── 5) Mux video+bed, and a silent copy (same video stream) for VEED ──
console.log("Muxing…");
ff(["-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", BED,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT]);
ff(["-i", OUT, "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", SILENT]);

// ── 6) Narration timing sheet for VEED (pacing aid; NOT baked) ──
const LINES = ["One customer reaches out.", "Somebody sees the message.", "But nobody owns what happens next.",
  "Sales thinks the front desk has it.", "The front desk thinks sales has it.", "And the lead just sits there.",
  "Until it doesn't.", "That's not really a follow-up problem. It's a workflow problem.",
  "Every opportunity should have an owner, a next action, and a closed loop.", "Good follow-up shouldn't depend on memory."];
const anchors = [TL.inq + 0.6, TL.viewed, TL.saw, TL.lanes + 0.4, TL.lanes + 1.6, TL.times, TL.cold, TL.stopped, TL.owner, TL.memory];
const fmt = (s) => { const m = Math.floor(s / 60), r = (s % 60).toFixed(1).padStart(4, "0"); return `${String(m).padStart(2, "0")}:${r}`; };
let sheet = `# Content #003 — Narration Timing Sheet (for VEED)\n\nPaste narration into VEED, pick a premium voice, align each line near the anchor below.\nThe sound design + visual beats already land here. Video is 1080×1920, ${TL.end}s, faceless.\nUse **field-note-003-silent.mp4** to add your own music too, or narrate over field-note-003.mp4\n(the clean bed already sits below a normal speaking voice).\n\n| # | ~Anchor | Line |\n| - | ------- | ---- |\n`;
LINES.forEach((l, i) => { sheet += `| ${i + 1} | ${fmt(anchors[i])} | ${l} |\n`; });
sheet += `\n**Do not clone Jordan's voice.** Use an authorized premium/company voice. Leave substantial midrange headroom.\n`;
mkdirSync(DOCS, { recursive: true });
writeFileSync(join(DOCS, "CONTENT-003-NARRATION-TIMING.md"), sheet);

rmSync(TMP, { recursive: true, force: true });
console.log(`\nDone:\n  ${OUT}\n  ${SILENT}\n  ${BED}\n  ${join(DOCS, "CONTENT-003-NARRATION-TIMING.md")}`);

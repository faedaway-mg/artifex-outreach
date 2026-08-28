#!/usr/bin/env node
// Build Content #002 (Artifex Labs field note) → field-note-002.mp4.
// Story: one customer's record is copied by hand across Form → Email → Spreadsheet → CRM, then
// Artifex connects the systems so it happens once. Same visual family as #001 (scene-002.html).
// Audio is 100% TONAL synthesis (sine + aevalsrc glides) — NO noise generators, learning from the
// #001 V4 cleanup. NO baked narration: a clean midrange lane is left for Jordan's VEED voice.
// Emits: field-note-002.mp4 (video+bed), field-note-002-silent.mp4 (video only, for VEED),
// field-note-002-soundbed.wav (stem), CONTENT-002-NARRATION-TIMING.md. Deterministic.
import { spawn, execFileSync, execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "content", "field-note-002");
const DOCS = join(ROOT, "docs", "content");
const TMP = join(ROOT, ".tmp-002"), CUE = join(TMP, "cue"), FRAMES = join(TMP, "frames"), SEG = join(TMP, "seg");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SCENE = `file://${join(DIR, "scene-002.html")}`;
const OUT = join(DIR, "field-note-002.mp4");
const SILENT = join(DIR, "field-note-002-silent.mp4");
const BED = join(DIR, "field-note-002-soundbed.wav");
const FPS = 24, PORT = 9266, VOICE = "Daniel", RATE = 172;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dur = (f) => parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "${f}"`).toString().trim());
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });

// Explicit storyboard timeline (matches scene-002.html defaults so cues + visuals share one clock).
const TL = { form: 0.3, submit: 2.9, once: 3.3, email: 4.6, copy: 5.6, again: 6.9, sheet: 8.4, entry2: 9.6,
  entry3: 11.2, crm: 13.2, andagain: 14.2, recog: 15.6, cost: 18.2, mismatch: 19.8, notwork: 20.5, moving: 21.4,
  turn: 22.4, once2: 24.1, rest: 25.3, people: 28.4, notmove: 29.7, brand: 31.0, end: 33.3 };

rmSync(TMP, { recursive: true, force: true });
[CUE, FRAMES, SEG].forEach((d) => mkdirSync(d, { recursive: true }));

// ── 1) TONAL cue palette (no noise). volume applied per placement. ──
const cue = (name, input, af) => { const f = join(CUE, name + ".wav"); ff(["-f", "lavfi", "-i", input, "-af", af, f]); return f; };
const C = {
  tick: cue("tick", "sine=frequency=1600:duration=0.03", "afade=t=out:st=0.008:d=0.022"),          // micro tick (copy)
  celllock: cue("celllock", "sine=frequency=900:duration=0.08", "afade=t=out:st=0.03:d=0.05"),      // spreadsheet cell lock
  crmtick: cue("crmtick", "sine=frequency=680:duration=0.13", "afade=t=out:st=0.05:d=0.08"),        // crm entry
  activate: cue("activate", "sine=frequency=560:duration=0.14", "afade=t=out:st=0.05:d=0.09"),       // submit
  confirm: cue("confirm", "sine=frequency=784:duration=0.20", "afade=t=out:st=0.09:d=0.11"),         // positive
  chime: cue("chime", "sine=frequency=1046:duration=0.24", "afade=t=out:st=0.10:d=0.14"),            // email discovery "oh"
  low: cue("low", "sine=frequency=294:duration=0.5", "afade=t=out:st=0.2:d=0.3"),                    // soft low tone (card)
  pulse: cue("pulse", "sine=frequency=360:duration=0.3", "afade=t=out:st=0.12:d=0.18"),              // warm
  recoghit: cue("recoghit", "sine=frequency=220:duration=1.2", "afade=t=in:d=0.3,afade=t=out:st=0.7:d=0.5"), // recognition landing
  presolve: cue("presolve", "sine=frequency=196:duration=1.8", "afade=t=in:d=0.6,afade=t=out:st=1.1:d=0.7"), // calm resolve pad
  brand: cue("brand", "sine=frequency=261.6:duration=0.9", "afade=t=out:st=0.3:d=0.6"),              // warm low brand resolve
  // rising tonal glide — Artifex connection (clean, replaces any "whoosh")
  connect: cue("connect", "aevalsrc=0.5*sin(2*PI*(300*t+300*t*t)):d=0.7:s=44100", "lowpass=f=3000,afade=t=in:d=0.12,afade=t=out:st=0.45:d=0.25"),
  // falling tonal glide — smooth connected-flow movement
  glide: cue("glide", "aevalsrc=0.5*sin(2*PI*(560*t-150*t*t)):d=0.6:s=44100", "lowpass=f=2800,afade=t=in:d=0.12,afade=t=out:st=0.35:d=0.25"),
};
// mismatch warning — restrained two-note minor-second down (pure sine, not harsh).
const warn = join(CUE, "warn.wav");
ff(["-f", "lavfi", "-i", "sine=frequency=523.25:duration=0.14", "-f", "lavfi", "-i", "sine=frequency=466.16:duration=0.20",
  "-filter_complex", "[0:a]afade=t=out:st=0.06:d=0.08[a];[1:a]adelay=150|150,afade=t=out:st=0.10:d=0.10[b];[a][b]amix=inputs=2:normalize=0,volume=0.9[o]",
  "-map", "[o]", warn]);
C.warn = warn;

// clean low drone bed — sine 72 + 108, dark low-pass, no air/noise layer.
const atmo = join(CUE, "atmo.wav");
ff(["-f", "lavfi", "-i", `sine=frequency=72:duration=${TL.end}`, "-f", "lavfi", "-i", `sine=frequency=108:duration=${TL.end}`,
  "-filter_complex", "[0:a]volume=0.5[a];[1:a]volume=0.34[b];[a][b]amix=inputs=2:normalize=0,lowpass=f=220,volume=0.6[o]",
  "-map", "[o]", atmo]);

// ── 2) Cue placements on STORY BEATS (not every field). (time, base, volume) ──
const P = [{ f: atmo, at: 0, v: 1.0 }];
P.push({ f: C.activate, at: TL.submit + 0.25, v: 0.22 });                 // customer submit
P.push({ f: C.low, at: TL.once, v: 0.13 });                              // "entered it once" card
P.push({ f: C.chime, at: TL.email + 0.15, v: 0.26 });                    // email arrival (discovery)
[0, 0.65, 1.2].forEach((d) => P.push({ f: C.tick, at: TL.copy + 0.1 + d, v: 0.12 })); // copy name/email/phone
[0, 0.4, 0.8, 1.2].forEach((d) => P.push({ f: C.celllock, at: TL.entry2 + d, v: 0.12 })); // spreadsheet cells
P.push({ f: C.celllock, at: TL.entry3, v: 0.15 });                       // ENTRY #3 advance
P.push({ f: C.crmtick, at: TL.crm + 0.4, v: 0.15 });                     // crm entry
P.push({ f: C.crmtick, at: TL.andagain, v: 0.13 });                      // "and again"
P.push({ f: C.recoghit, at: TL.recog, v: 0.18 });                        // recognition landing
for (let i = 0; i < 5; i++) P.push({ f: C.tick, at: TL.cost + 0.2 + i * 0.25, v: 0.08 }); // task chips (very restrained)
P.push({ f: C.warn, at: TL.mismatch + 0.6, v: 0.16 });                   // data mismatch (restrained)
P.push({ f: C.low, at: TL.moving, v: 0.12 });                            // "moving information..." underline
P.push({ f: C.connect, at: TL.turn + 0.4, v: 0.18 });                    // Artifex connection (rising glide)
P.push({ f: C.confirm, at: TL.once2, v: 0.18 });                         // "enter it once"
P.push({ f: C.glide, at: TL.rest, v: 0.16 });                            // connected flow movement
P.push({ f: C.pulse, at: TL.people, v: 0.16 });                          // "your people..."
P.push({ f: C.presolve, at: TL.brand - 0.2, v: 0.20 });                  // calm pad under resolve
P.push({ f: C.brand, at: TL.brand + 0.2, v: 0.22 });                     // warm low brand resolve

// ── 3) Mix the CLEAN sound-design master (no narration). Low peaks → VO headroom. ──
const ins = [], filt = [], lab = [];
P.forEach((p, k) => { ins.push("-i", p.f); const ms = Math.max(0, Math.round(p.at * 1000)); filt.push(`[${k}:a]adelay=${ms}|${ms},volume=${p.v}[a${k}]`); lab.push(`[a${k}]`); });
ff([...ins, "-filter_complex", `${filt.join(";")};${lab.join("")}amix=inputs=${lab.length}:normalize=0:duration=longest,apad=whole_dur=${TL.end},volume=0.62,alimiter=limit=0.7[out]`, "-map", "[out]", "-ar", "44100", BED]);
const md = execSync(`ffmpeg -i "${BED}" -af volumedetect -f null - 2>&1 | grep -E "max_volume" || true`).toString().trim();
console.log("Soundbed built. " + md + " (headroom for VO)");

// ── 4) Render frames via one persistent Chrome; inject TL. ──
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
  "--no-default-browser-check", `--remote-debugging-port=${PORT}`, "--user-data-dir=/tmp/cr-fn002",
  "--force-device-scale-factor=1", "--window-size=1080,1920", `${SCENE}?t=0`], { stdio: "ignore" });
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(150); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((x) => x.type === "page" && (x.url || "").includes("scene-002.html")); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} }
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

// ── 5) Mux video+bed, and a silent copy (same video stream) for VEED. ──
console.log("Muxing…");
ff(["-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", BED,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT]);
ff(["-i", OUT, "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", SILENT]);

// ── 6) Narration timing sheet for VEED (pacing aid; NOT baked). ──
const LINES = ["One customer fills out one form.", "Then somebody copies it into an email.", "Then a spreadsheet.",
  "Then another system.", "The customer entered the information once.", "Your team keeps entering it again.",
  "That's not really a people problem. It's a systems problem.", "Your people should run the business — not move data between software."];
const anchors = [TL.form + 0.6, TL.copy, TL.sheet + 0.3, TL.crm + 0.3, TL.recog + 0.3, TL.cost + 0.4, TL.moving, TL.people];
const fmt = (s) => { const m = Math.floor(s / 60), r = (s % 60).toFixed(1).padStart(4, "0"); return `${String(m).padStart(2, "0")}:${r}`; };
let sheet = `# Content #002 — Narration Timing Sheet (for VEED)\n\nPaste narration into VEED, pick a premium voice, align each line near the anchor below.\nThe sound design + visual beats already land here. Video is 1080×1920, ${TL.end}s, faceless.\nUse **field-note-002-silent.mp4** if you want to add your own music too; otherwise the clean bed in\nfield-note-002.mp4 already sits below a normal speaking voice.\n\n| # | ~Anchor | Line |\n| - | ------- | ---- |\n`;
LINES.forEach((l, i) => { sheet += `| ${i + 1} | ${fmt(anchors[i])} | ${l} |\n`; });
sheet += `\n**Do not clone Jordan's voice.** Use an authorized premium/company voice. Leave substantial midrange headroom.\n`;
mkdirSync(DOCS, { recursive: true });
writeFileSync(join(DOCS, "CONTENT-002-NARRATION-TIMING.md"), sheet);

rmSync(TMP, { recursive: true, force: true });
console.log(`\nDone:\n  ${OUT}\n  ${SILENT}\n  ${BED}\n  ${join(DOCS, "CONTENT-002-NARRATION-TIMING.md")}`);

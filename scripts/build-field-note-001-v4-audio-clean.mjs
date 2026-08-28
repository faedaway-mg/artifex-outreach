#!/usr/bin/env node
// Content #001 V4 — AUDIO CLEANUP PASS ONLY.
// Rebuilds ONLY the noise-based audio sources of V4 as clean tonal synthesis, remuxes onto the
// EXISTING V4 video stream (copied, not re-rendered) → visuals/timing are frame-for-frame identical.
//
// What changed vs build-field-note-001-v4.mjs (audio only):
//   • atmo   — REMOVED the high-passed pink-noise "air" layer (the continuous hiss). Clean low drone only.
//   • scan   — REBUILT from pink noise → a soft rising tonal glide (filtered sine chirp).
//   • whoosh — REBUILT from pink noise → a clean falling tonal glide.
//   • all sine UI cues (tick/activate/optimized/chime/rresolve/pulse/presolve/brand) are UNCHANGED.
//   • +7.9 dB master makeup so the liked cues land at their EXACT approved V4 absolute level.
// Narration timeline + cue placements are recomputed identically (deterministic `say`) so the clean
// audio lands on the exact same events as the existing video. Originals are NOT overwritten.
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "content", "field-note-001");
const TMP = join(ROOT, ".tmp-v4-clean"), SEG = join(TMP, "seg"), CUE = join(TMP, "cue");
const V4_VIDEO = join(DIR, "field-note-001-v4.mp4");        // source of the (unchanged) visuals
const OUT = join(DIR, "field-note-001-v4-audio-clean.mp4"); // cleaned deliverable
const BED = join(DIR, "field-note-001-v4-soundbed-clean.wav");
const VOICE = "Daniel", RATE = 172;
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
[SEG, CUE].forEach((d) => mkdirSync(d, { recursive: true }));

// 1) Measure narration → identical timeline (deterministic; matches the existing video).
console.log("Measuring narration timing (say)…");
const len = [], start = [];
LINES.forEach((line, i) => { const f = join(SEG, `s${i}.aiff`); execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", f, line]); len.push(dur(f)); });
let cur = 0; for (let i = 0; i < LINES.length; i++) { cur += GAP[i]; start.push(cur); cur += len[i]; }
const TL = { b1: start[0], opt: start[1], calls: start[2], freeze: start[3], site: start[4], reveal: start[5],
  flow: start[6], doc: start[7], send: start[8], principle: start[8] + len[8] + 0.15, brand: start[9], cta: start[9] + len[9] + 0.25, end: 0 };
TL.principle = start[8];
TL.end = +(TL.cta + 2.8).toFixed(2);
const videoDur = dur(V4_VIDEO);
console.log("TL:", JSON.stringify(TL));
console.log(`TL.end=${TL.end}  videoDur=${videoDur.toFixed(3)}  (delta ${(Math.abs(TL.end - videoDur)).toFixed(3)}s — cue alignment)`);

// 2) Cue sounds. SINE cues are byte-identical to V4. scan/whoosh rebuilt tonal. No noise generators.
const cue = (name, input, af) => { const f = join(CUE, name + ".wav"); ff(["-f", "lavfi", "-i", input, "-af", af, f]); return f; };
const C = {
  // --- UNCHANGED sine UI cues (the ones Jordan likes) ---
  tick: cue("tick", "sine=frequency=1600:duration=0.03", "afade=t=out:st=0.008:d=0.022"),
  activate: cue("activate", "sine=frequency=560:duration=0.14", "afade=t=out:st=0.05:d=0.09"),
  optimized: cue("optimized", "sine=frequency=784:duration=0.20", "afade=t=out:st=0.09:d=0.11"),
  chime: cue("chime", "sine=frequency=1046:duration=0.24", "afade=t=out:st=0.10:d=0.14"),
  rresolve: cue("rresolve", "sine=frequency=294:duration=0.5", "afade=t=out:st=0.2:d=0.3"),
  pulse: cue("pulse", "sine=frequency=360:duration=0.3", "afade=t=out:st=0.12:d=0.18"),
  presolve: cue("presolve", "sine=frequency=196:duration=1.6", "afade=t=in:d=0.5,afade=t=out:st=1.0:d=0.6"),
  brand: cue("brand", "sine=frequency=523:duration=0.6", "afade=t=out:st=0.2:d=0.4"),
  // --- REBUILT tonal motion sounds (were pink-noise) ---
  // scan: soft rising filtered glide (~500→~1300Hz) instead of high-passed noise "SHHHH".
  scan: cue("scan", "aevalsrc=0.55*sin(2*PI*(500*t+240*t*t)):d=1.8:s=44100",
    "lowpass=f=3200,afade=t=in:d=0.5,afade=t=out:st=1.1:d=0.7"),
  // whoosh: clean falling tonal glide (~640→~440Hz) for the send. No broadband air.
  whoosh: cue("whoosh", "aevalsrc=0.6*sin(2*PI*(640*t-180*t*t)):d=0.5:s=44100",
    "lowpass=f=2800,afade=t=in:d=0.12,afade=t=out:st=0.25:d=0.25"),
};

// Atmospheric bed — CLEAN. Low tonal drone only (72 + 108 Hz), no air/noise layer, dark low-pass.
const atmo = join(CUE, "atmo.wav");
ff(["-f", "lavfi", "-i", `sine=frequency=72:duration=${TL.end}`, "-f", "lavfi", "-i", `sine=frequency=108:duration=${TL.end}`,
  "-filter_complex", "[0:a]volume=0.5[a];[1:a]volume=0.34[b];[a][b]amix=inputs=2:normalize=0,lowpass=f=220,volume=0.6[o]",
  "-map", "[o]", atmo]);

// 3) Placements — IDENTICAL to V4 (time, base, volume).
const P = [{ f: atmo, at: 0, v: 1.0 }];
P.push({ f: C.activate, at: TL.b1 + 0.15, v: 0.16 });
P.push({ f: C.optimized, at: TL.opt, v: 0.24 });
const step = (TL.freeze - TL.calls - 0.2) / 8;
for (let i = 0; i < 8; i++) P.push({ f: C.tick, at: TL.calls + 0.2 + i * step, v: 0.10 + 0.10 * (i / 7) });
P.push({ f: C.scan, at: TL.site + 0.6, v: 0.10 });
P.push({ f: C.chime, at: TL.reveal, v: 0.30 });
[0, 1.4, 2.6, 3.8].forEach((d) => P.push({ f: C.tick, at: TL.doc + d, v: 0.14 }));
P.push({ f: C.rresolve, at: TL.doc + (TL.send - TL.doc) * 0.85, v: 0.20 });
P.push({ f: C.whoosh, at: TL.send, v: 0.12 });
P.push({ f: C.optimized, at: TL.send + 1.0, v: 0.18 });
P.push({ f: C.pulse, at: TL.send + 2.4, v: 0.16 });
P.push({ f: C.presolve, at: TL.principle, v: 0.22 });
P.push({ f: C.brand, at: TL.cta, v: 0.18 });

// 4) Mix the CLEAN sound-design master (no narration). Same downstream chain as V4, PLUS a fixed
// makeup gain: removing the noise energy made the limiter's auto-level pull the whole master down a
// uniform ~7.9 dB (measured: every sine cue sat 7.8–7.9 dB below its V4 level). We add it back so the
// liked UI cues land at their EXACT approved V4 absolute level — only the hiss is gone, nothing quieter.
const CUE_MAKEUP_DB = 7.9; // restores cues to V4 absolute level; master peak stays ~-9 dB (no clip).
const ins = [], filt = [], lab = [];
P.forEach((p, k) => { ins.push("-i", p.f); const ms = Math.max(0, Math.round(p.at * 1000)); filt.push(`[${k}:a]adelay=${ms}|${ms},volume=${p.v}[a${k}]`); lab.push(`[a${k}]`); });
ff([...ins, "-filter_complex", `${filt.join(";")};${lab.join("")}amix=inputs=${lab.length}:normalize=0:duration=longest,apad=whole_dur=${TL.end},volume=0.55,alimiter=limit=0.55,volume=${CUE_MAKEUP_DB}dB[out]`, "-map", "[out]", "-ar", "44100", BED]);
const md = execSync(`ffmpeg -i "${BED}" -af volumedetect -f null - 2>&1 | grep -E "max_volume" || true`).toString().trim();
console.log("Clean soundbed built. " + md + " (headroom for VO)");

// 5) Remux: EXISTING V4 video (copied, unchanged) + clean audio → cleaned MP4.
console.log("Remuxing clean audio onto unchanged V4 video…");
ff(["-i", V4_VIDEO, "-i", BED, "-map", "0:v:0", "-map", "1:a:0",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", OUT]);

rmSync(TMP, { recursive: true, force: true });
console.log(`\nDone:\n  ${OUT}\n  ${BED}`);

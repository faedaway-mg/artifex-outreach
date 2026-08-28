#!/usr/bin/env node
// ARTIFEX FIELD NOTES — VO finishing pass for #004–#006.
// For each note: sync the existing scene to the SUPPLIED voiceover (piecewise-linear time-warp to the
// VO's phrasing), rebuild a CUE-ONLY audio stem (NO drone/atmosphere — removed at source), mix
// VOICE + ducked cues, and export a posting-ready final. Preserves originals; #001–#003 untouched.
// Usage: node scripts/finish-field-note-vo.mjs <note> <voPath>   (or loops the three via a wrapper)
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { NOTES } from "./lib/notes.mjs";
import { buildPalette, mixBed, renderFrames, readSpeech, warpTimeline, voToWav, mixVoiceCues, embedThumbnailFrameZero } from "./lib/fieldnote.mjs";
import { existsSync } from "node:fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 24;
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });

const note = process.argv[2];
const voPath = process.argv[3];
const cfg = NOTES[note];
if (!cfg || !voPath) { console.error("usage: finish-field-note-vo.mjs <004|005|006> <voPath>"); process.exit(1); }

const dir = join(ROOT, "public", "content", `field-note-${note}`);
const tmp = join(ROOT, `.tmp-${note}-vo`), CUE = join(tmp, "cue"), FRAMES = join(tmp, "frames");
rmSync(tmp, { recursive: true, force: true }); [CUE, FRAMES].forEach((d) => mkdirSync(d, { recursive: true }));

// 1) Analyse the VO and warp the timeline to it.
const speech = readSpeech(voPath);
const newTL = warpTimeline(cfg.TL, cfg.narrTimes, speech);
console.log(`#${note}: VO ${speech.voDur.toFixed(2)}s, ${speech.speechStarts.length} speech segments, speechEnd ${speech.speechEnd.toFixed(2)}s`);
console.log(`  base end ${cfg.TL.end}s → final end ${newTL.end}s (brand ${newTL.brand}s)`);

// 2) Render frames at the synced timeline (native 1080×1920 viewport — no white bar at source).
await renderFrames({ sceneFile: join(dir, cfg.sceneBasename), sceneBasename: cfg.sceneBasename, TL: newTL, port: cfg.port, framesDir: FRAMES });

// 2b) THUMBNAIL-FIRST: frame zero becomes the generated cover (pipeline default; automatic for #007+).
const thumbPath = join(ROOT, "public", "content", "thumbnails", `field-note-${note}-thumbnail.png`);
if (existsSync(thumbPath)) { embedThumbnailFrameZero({ framesDir: FRAMES, thumbPath }); console.log("  thumbnail embedded as frame zero: " + thumbPath); }
else console.log("  WARNING: no thumbnail at " + thumbPath);

// 3) Build CUE-ONLY stem (no atmosphere) at the synced beats.
const C = buildPalette(CUE, newTL.end);
const cuesWav = join(dir, `field-note-${note}-cues.wav`);
const cmd = mixBed(cfg.placements(C, newTL), newTL.end, cuesWav);
console.log("  cue-only stem: " + cmd);

// 4) VO stem + final mix (VOICE dominant + ducked cues, no bed).
const voWav = join(dir, `field-note-${note}-voiceover.wav`);
voToWav(voPath, voWav);
const mixWav = join(dir, `field-note-${note}-final-mix.wav`);
const mixInfo = mixVoiceCues({ voWav, cuesWav, endSec: newTL.end, outWav: mixWav });
console.log("  final mix: " + mixInfo);

// 5) Mux frames + final mix → final-vo.mp4 (does NOT overwrite the approved field-note-XXX.mp4).
const out = join(dir, `field-note-${note}-final-vo.mp4`);
ff(["-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", mixWav,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);

rmSync(tmp, { recursive: true, force: true });
console.log(`\n#${note} DONE:\n  ${out}\n  ${cuesWav}\n  ${voWav}\n  ${mixWav}`);

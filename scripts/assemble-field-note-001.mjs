#!/usr/bin/env node
// Assemble Content #001 (ARTIFEX / FIELD NOTE 001) — Mode C: TEXT/MOTION ONLY, faceless, no
// narration. Rasterizes the 7 held SVG slides via headless Chrome (true 1080×1920, correct fonts),
// then ffmpeg-composes a restrained fade-through-black 9:16 MP4 (silent AAC track for platform
// compatibility). Deterministic + reproducible. This assembles ONE artifact — not a video engine.
//
// Run: node scripts/assemble-field-note-001.mjs   → public/content/field-note-001/field-note-001.mp4
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "public", "content", "field-note-001");
const TMP = join(ROOT, ".tmp-fn001");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(DIR, "field-note-001.mp4");
const COVER = join(DIR, "cover.png");

// The six timed beats and how long each holds (seconds). Paced for comprehension: the discovery
// turn and the redesign flow get the most room. ~70s total.
const BEATS = [
  { svg: "01-hook.svg", dur: 8 },
  { svg: "02-wrong-work.svg", dur: 10 },
  { svg: "03-discovery.svg", dur: 12 },
  { svg: "04-redesign.svg", dur: 18 },
  { svg: "05-principle.svg", dur: 10 },
  { svg: "06-cta.svg", dur: 12 },
];
const FADE = 0.5; // restrained fade in/out (through black) between beats — a lab feel, not flashy.

function shoot(svg, png) {
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=1080,1920", `--screenshot=${png}`, `file://${join(DIR, svg)}`,
  ], { stdio: "ignore" });
  if (!existsSync(png)) throw new Error(`Chrome failed to rasterize ${svg}`);
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// 1) Rasterize each beat + the cover to true 1080×1920 PNGs.
console.log("Rasterizing slides (headless Chrome)…");
const clips = [];
BEATS.forEach((b, i) => {
  const png = join(TMP, `beat${i}.png`);
  shoot(b.svg, png);
  const clip = join(TMP, `clip${i}.mp4`);
  // Static hold with a gentle fade in/out through black — clean, restrained, deterministic.
  execFileSync("ffmpeg", [
    "-y", "-loop", "1", "-t", String(b.dur), "-i", png,
    "-vf", `fps=30,fade=t=in:st=0:d=${FADE},fade=t=out:st=${b.dur - FADE}:d=${FADE},format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30", clip,
  ], { stdio: "ignore" });
  clips.push(clip);
  console.log(`  ✓ ${b.svg} → ${b.dur}s`);
});
shoot("07-cover.svg", COVER);

// 2) Concatenate the beat clips into the final MP4 + a silent audio track (platform compatibility).
const list = join(TMP, "list.txt");
writeFileSync(list, clips.map((c) => `file '${c}'`).join("\n"));
console.log("Composing final MP4…");
execFileSync("ffmpeg", [
  "-y", "-f", "concat", "-safe", "0", "-i", list,
  "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-shortest", "-movflags", "+faststart", OUT,
], { stdio: "ignore" });

rmSync(TMP, { recursive: true, force: true });
const total = BEATS.reduce((a, b) => a + b.dur, 0);
console.log(`\nDone (~${total}s):\n  ${OUT}\n  ${COVER}`);

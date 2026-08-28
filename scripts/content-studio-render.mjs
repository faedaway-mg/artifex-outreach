#!/usr/bin/env node
// ARTIFEX CONTENT STUDIO — render worker (detached background job).
// Invoked by the Content Studio runner: `node scripts/content-studio-render.mjs <jobId>`.
// Reads the durable job file, renders via the real engine (headless Chrome + ffmpeg), embeds the
// generated thumbnail as frame zero, streams progress back into the job file. Two rendering paths:
//   • TEMPLATE piece (data-driven, #007+) → generic scene-template.html from validated JSON + uploaded VO
//   • LEGACY scene  (#004–#006)           → the wired scene HTML; reuse approved audio OR uploaded VO
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { NOTES } from "./lib/notes.mjs";
import { renderFrames, readSpeech, warpTimeline, embedThumbnailFrameZero, buildPalette, mixBed, voToWav, mixVoiceCues, dur } from "./lib/fieldnote.mjs";
import { buildTemplateTimeline, buildTemplateCues } from "./lib/template.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 24;
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });
const jobId = process.argv[2];
if (!jobId) { console.error("usage: content-studio-render.mjs <jobId>"); process.exit(1); }

const JOB_FILE = join(ROOT, ".data", "content-studio", "jobs", `${jobId}.json`);
const readJob = () => JSON.parse(readFileSync(JOB_FILE, "utf8"));
function patchJob(patch) {
  const j = { ...readJob(), ...patch, updatedAt: new Date().toISOString() };
  const tmp = JOB_FILE + ".tmp-" + process.pid;
  writeFileSync(tmp, JSON.stringify(j, null, 2)); renameSync(tmp, JOB_FILE);
  return j;
}
function templatePath(id) {
  const safe = String(id).replace(/[^0-9a-z_-]/gi, "_");
  for (const p of [join(ROOT, ".data", "content-studio", "templates", `${safe}.json`), join(ROOT, "public", "content", "templates", `${safe}.json`)])
    if (existsSync(p)) return p;
  return null;
}
const PORT = 9320 + (process.pid % 40);

async function main() {
  const job = readJob();
  const note = job.pieceId;
  patchJob({ status: "rendering", stage: "Preparing", progress: 0.02, startedAt: new Date().toISOString(), pid: process.pid });

  const dir = join(ROOT, "public", "content", `field-note-${note}`);
  mkdirSync(dir, { recursive: true });
  const thumbPath = join(ROOT, "public", "content", "thumbnails", `field-note-${note}-thumbnail.png`);
  if (!existsSync(thumbPath)) throw new Error("thumbnail missing (generate it at template-create time): " + thumbPath);
  const tmp = join(ROOT, `.tmp-cs-${jobId}`), FRAMES = join(tmp, "frames"), CUE = join(tmp, "cue");
  rmSync(tmp, { recursive: true, force: true }); [FRAMES, CUE].forEach((d) => mkdirSync(d, { recursive: true }));

  const tplPath = templatePath(note);
  let out, audioNote, newTL;

  if (tplPath) {
    // ── DATA-DRIVEN TEMPLATE PATH ──────────────────────────────────────────────
    const tpl = JSON.parse(readFileSync(tplPath, "utf8"));
    if (job.mode !== "uploaded-vo" || !job.audioFile) throw new Error("template pieces require an uploaded voiceover");
    if (!existsSync(job.audioFile)) throw new Error("voiceover not found: " + job.audioFile);
    patchJob({ stage: "Analyzing voiceover", progress: 0.06 });
    const speech = readSpeech(job.audioFile);
    newTL = buildTemplateTimeline(tpl, speech);
    patchJob({ stage: "Rendering frames", progress: 0.08 });
    await renderFrames({
      sceneFile: join(ROOT, "public", "content", "_shared", "scene-template.html"), sceneBasename: "scene-template.html",
      TL: newTL, port: PORT, framesDir: FRAMES, globals: { TEMPLATE: tpl },
      onProgress: (i, n) => patchJob({ stage: `Rendering frames ${i}/${n}`, progress: 0.08 + 0.72 * (i / n) }),
    });
    patchJob({ stage: "Embedding thumbnail", progress: 0.82 });
    embedThumbnailFrameZero({ framesDir: FRAMES, thumbPath });
    patchJob({ stage: "Mixing voiceover + cues", progress: 0.9 });
    const C = buildPalette(CUE, newTL.end);
    const cuesWav = join(tmp, "cues.wav");
    mixBed(buildTemplateCues(tpl, C, newTL), newTL.end, cuesWav);
    const voWav = join(tmp, "vo.wav"); voToWav(job.audioFile, voWav);
    const mixWav = join(tmp, "mix.wav"); mixVoiceCues({ voWav, cuesWav, endSec: newTL.end, outWav: mixWav });
    out = join(dir, `field-note-${note}-final.mp4`);
    ff(["-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", mixWav,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
    audioNote = "data-driven template · voice+cue mix from uploaded VO";
  } else {
    // ── LEGACY WIRED-SCENE PATH (#004–#006) ────────────────────────────────────
    const cfg = NOTES[note];
    if (!cfg) throw new Error(`no scene or template wired for #${note}`);
    const voPath = job.mode === "uploaded-vo" ? job.audioFile : join(dir, `field-note-${note}-voiceover-input.mp3`);
    if (!existsSync(voPath)) throw new Error("voiceover not found: " + voPath);
    patchJob({ stage: "Analyzing voiceover", progress: 0.06 });
    const speech = readSpeech(voPath);
    newTL = warpTimeline(cfg.TL, cfg.narrTimes, speech);
    patchJob({ stage: "Rendering frames", progress: 0.08 });
    await renderFrames({
      sceneFile: join(dir, cfg.sceneBasename), sceneBasename: cfg.sceneBasename, TL: newTL, port: cfg.port, framesDir: FRAMES,
      onProgress: (i, n) => patchJob({ stage: `Rendering frames ${i}/${n}`, progress: 0.08 + 0.72 * (i / n) }),
    });
    patchJob({ stage: "Embedding thumbnail", progress: 0.82 });
    embedThumbnailFrameZero({ framesDir: FRAMES, thumbPath });
    if (job.mode === "reuse-approved-audio") {
      const approved = join(dir, `field-note-${note}-final-vo.mp4`);
      if (!existsSync(approved)) throw new Error("approved final-vo not found to copy audio from: " + approved);
      patchJob({ stage: "Muxing (copying approved audio)", progress: 0.9 });
      out = join(dir, `field-note-${note}-final-vo-thumb.mp4`);
      ff(["-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", approved,
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out]);
      const amd5 = (f) => execSync(`ffmpeg -v error -i "${f}" -map 0:a:0 -f md5 -`).toString().trim();
      audioNote = amd5(out) === amd5(approved) ? "approved audio copied (md5 identical)" : "audio differs";
    } else {
      patchJob({ stage: "Mixing voiceover + cues", progress: 0.9 });
      const C = buildPalette(CUE, newTL.end);
      const cuesWav = join(tmp, "cues.wav");
      mixBed(cfg.placements(C, newTL), newTL.end, cuesWav);
      const voWav = join(tmp, "vo.wav"); voToWav(voPath, voWav);
      const mixWav = join(tmp, "mix.wav"); mixVoiceCues({ voWav, cuesWav, endSec: newTL.end, outWav: mixWav });
      out = join(dir, `field-note-${note}-final-vo-custom.mp4`);
      ff(["-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", mixWav,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
      audioNote = "fresh voice+cue mix from uploaded VO (re-encoded AAC)";
    }
  }

  rmSync(tmp, { recursive: true, force: true });
  const outRel = "/content/" + out.slice(out.indexOf(`field-note-${note}/`));
  patchJob({
    status: "ready", stage: "Ready", progress: 1, outputFile: out, outputRel: outRel,
    finishedAt: new Date().toISOString(), error: null, audioLabel: job.audioLabel || audioNote,
  });
  console.log(`job ${jobId} ready → ${out} (${audioNote}); duration ${dur(out).toFixed(2)}s`);
}

main().catch((e) => {
  try { patchJob({ status: "failed", stage: "Failed", error: String(e?.message || e) }); } catch {}
  console.error("job failed:", e);
  process.exit(1);
});

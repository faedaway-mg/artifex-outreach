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
import { materializeArtifact, putArtifact, buildObjectKey, closeArtifacts, getArtifactMeta, loadTemplatePgDoc } from "./lib/cs-artifacts.mjs";
import { renderTemplateThumbnail } from "./render-template-thumbnail.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 24;

// Environment for object keys — mirrors src/lib/content-studio/env-guard.ts csEnvironment().
function csEnv() {
  const e = (process.env.CS_ENV ?? "").trim().toLowerCase();
  if (["staging", "production", "development", "test"].includes(e)) return e;
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "development";
}
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });
const jobId = process.argv[2];
if (!jobId) { console.error("usage: content-studio-render.mjs <jobId>"); process.exit(1); }

const JOB_FILE = join(ROOT, ".data", "content-studio", "jobs", `${jobId}.json`);
const TMP = join(ROOT, `.tmp-cs-${jobId}`); // unique per job — holds frames, cues, and the materialized VO
const readJob = () => JSON.parse(readFileSync(JOB_FILE, "utf8"));

// Resolve the uploaded voiceover to a LOCAL path the render pipeline can read. Preferred source is the
// persisted object key (the cross-process ArtifactStore the web wrote via getArtifactStore) — bytes are
// read + integrity-verified + written into the job's tmp dir (removed with it) by materializeArtifact,
// which rejects a missing / deleted / expired / tampered input. The legacy job.audioFile path is only a
// dev fallback. The temp path is NEVER persisted back into the job.
async function materializeVoiceover(job) {
  if (job.audioKey) {
    const ext = (String(job.audioKey).split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
    const { path: p } = await materializeArtifact(job.audioKey, { destDir: TMP, filename: `vo-input.${ext}`, expectedSha: job.audioSha ?? null });
    return p;
  }
  return job.audioFile; // LEGACY dev fallback (no persisted key)
}

// Publish a rendered artifact to the ArtifactStore by canonical key (ownership-fenced by jobId,
// atomic + idempotent). Throws with a clear label on failure so the job fails and retries rather than
// completing without a durable object. Returns { key, sha, bytes }.
async function publishFile(key, localFile, contentType, artifactClass, jobId) {
  try {
    return await putArtifact(key, readFileSync(localFile), contentType, { artifactClass, jobId });
  } catch (e) {
    throw new Error(`${artifactClass} publication failed for ${key}: ${e?.message || e}`);
  }
}
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

// Resolve the cover thumbnail to a local path the frame renderer can embed as frame zero. Order:
//   1) committed seed file (seeded pieces #001–#007) — read-only, always present in the image;
//   2) a previously-published DURABLE thumbnail in the ArtifactStore (survives restart) → materialize;
//   3) GENERATE it from the operator-authored template's thumbnail spec (worker has Chrome), publish it
//      durably to the ArtifactStore, and use it. So an authored template's cover survives web+worker restarts
//      with no writable-container dependency. Throws only if there's genuinely nothing to render a cover from.
async function resolveThumbnail(note, tplDoc) {
  const committed = join(ROOT, "public", "content", "thumbnails", `field-note-${note}-thumbnail.png`);
  if (existsSync(committed)) return committed;
  const key = `content-studio/${csEnv()}/thumbnail/${String(note).replace(/[^0-9a-z_-]/gi, "-")}/cover.png`;
  if (await getArtifactMeta(key)) {
    const { path: p } = await materializeArtifact(key, { destDir: TMP, filename: "cover.png" });
    return p;
  }
  if (tplDoc && tplDoc.thumbnail) {
    mkdirSync(TMP, { recursive: true });
    const gen = join(TMP, "cover.png");
    await renderTemplateThumbnail({ tpl: tplDoc, outPng: gen, thumbDir: join(ROOT, "public", "content", "thumbnails") });
    await putArtifact(key, readFileSync(gen), "image/png", { artifactClass: "poster" });
    return gen;
  }
  throw new Error("no thumbnail and no template thumbnail spec to generate one: " + note);
}

async function main() {
  const job = readJob();
  const note = job.pieceId;
  patchJob({ status: "rendering", stage: "Preparing", progress: 0.02, startedAt: new Date().toISOString(), pid: process.pid });

  const dir = join(ROOT, "public", "content", `field-note-${note}`);
  mkdirSync(dir, { recursive: true });
  const tmp = TMP, FRAMES = join(tmp, "frames"), CUE = join(tmp, "cue");
  rmSync(tmp, { recursive: true, force: true }); [FRAMES, CUE].forEach((d) => mkdirSync(d, { recursive: true }));

  // Template doc: operator-authored templates live in Postgres (survive restart); a committed piece falls
  // back to its seed file. Resolve the cover thumbnail durably (may generate + publish it).
  const filePath = templatePath(note);
  const tplDoc = (await loadTemplatePgDoc(note)) ?? (filePath ? JSON.parse(readFileSync(filePath, "utf8")) : null);
  const thumbPath = await resolveThumbnail(note, tplDoc);

  let out, audioNote, newTL;

  if (tplDoc) {
    // ── DATA-DRIVEN TEMPLATE PATH ──────────────────────────────────────────────
    const tpl = tplDoc;
    if (job.mode !== "uploaded-vo" || (!job.audioFile && !job.audioKey)) throw new Error("template pieces require an uploaded voiceover");
    patchJob({ stage: "Analyzing voiceover", progress: 0.06 });
    const voPath = await materializeVoiceover(job);
    if (!voPath || !existsSync(voPath)) throw new Error("voiceover not found: " + (job.audioKey || job.audioFile));
    const speech = readSpeech(voPath);
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
    const voWav = join(tmp, "vo.wav"); voToWav(voPath, voWav);
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
    const voPath = job.mode === "uploaded-vo" ? await materializeVoiceover(job) : join(dir, `field-note-${note}-voiceover-input.mp3`);
    if (!voPath || !existsSync(voPath)) throw new Error("voiceover not found: " + (job.audioKey || job.audioFile || voPath));
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

  // DURABLE PUBLICATION — the job is NOT complete until both the rendered mp4 and the frame-zero poster
  // are published to the ArtifactStore by canonical key (ownership-fenced by jobId, so a stale attempt can
  // never overwrite a newer one). Keys are deterministic per (job, inputVersion) so a retry re-publishes
  // idempotently to the SAME key. The poster must publish too — if it fails, the whole job fails and
  // retries (we never mark ready with a video but no poster).
  patchJob({ stage: "Publishing", progress: 0.96 });
  const env = csEnv();
  const outputKey = buildObjectKey({ artifactClass: "render-output", env, jobId, version: job.inputVersion, ext: "mp4" });
  const posterKey = buildObjectKey({ artifactClass: "poster", env, jobId, version: job.inputVersion, ext: "png" });
  const videoPub = await publishFile(outputKey, out, "video/mp4", "render-output", jobId);
  const posterPub = await publishFile(posterKey, thumbPath, "image/png", "poster", jobId);

  patchJob({
    status: "ready", stage: "Ready", progress: 1, outputFile: out, outputRel: outRel,
    outputKey, posterKey,
    finishedAt: new Date().toISOString(), error: null, audioLabel: job.audioLabel || audioNote,
  });
  console.log(`job ${jobId} ready → ${outputKey} (${videoPub.bytes}B, sha ${String(videoPub.sha256).slice(0, 12)}…) + poster ${posterKey} (${posterPub.bytes}B); ${audioNote}; duration ${dur(out).toFixed(2)}s`);
}

main()
  .then(async () => { await closeArtifacts().catch(() => {}); })
  .catch(async (e) => {
    // Clean the temporary render directory (incl. the materialized VO) on failure — never leave it behind.
    try { rmSync(TMP, { recursive: true, force: true }); } catch {}
    await closeArtifacts().catch(() => {});
    try { patchJob({ status: "failed", stage: "Failed", error: String(e?.message || e) }); } catch {}
    console.error("job failed:", e);
    process.exit(1);
  });

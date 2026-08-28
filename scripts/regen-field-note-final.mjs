#!/usr/bin/env node
// ARTIFEX FIELD NOTES — clean regeneration of an already-approved narrated piece (#004–#006).
// Re-renders the scene at the NATIVE 1080×1920 viewport (root-cause white-bar fix, NOT a border smear),
// embeds the generated thumbnail as the FIRST DECODED FRAME, and COPIES the approved final audio stream
// byte-for-byte (no re-mix, no re-encode) from the existing field-note-<n>-final-vo.mp4. The timeline
// warp is deterministic from the same voiceover input, so the new frames stay in sync with that audio.
// Output is a clearly versioned NEW file; the approved -final-vo.mp4 is preserved untouched.
// Usage: node scripts/regen-field-note-final.mjs <004|005|006>
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { NOTES } from "./lib/notes.mjs";
import { renderFrames, readSpeech, warpTimeline, embedThumbnailFrameZero, dur } from "./lib/fieldnote.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 24;
const ff = (args) => execFileSync("ffmpeg", ["-y", ...args], { stdio: "ignore" });

const note = process.argv[2];
const cfg = NOTES[note];
if (!cfg) { console.error("usage: regen-field-note-final.mjs <004|005|006>"); process.exit(1); }

const dir = join(ROOT, "public", "content", `field-note-${note}`);
const voPath = join(dir, `field-note-${note}-voiceover-input.mp3`);
const approved = join(dir, `field-note-${note}-final-vo.mp4`);
const thumbPath = join(ROOT, "public", "content", "thumbnails", `field-note-${note}-thumbnail.png`);
for (const [label, p] of [["voiceover", voPath], ["approved final-vo", approved], ["thumbnail", thumbPath]])
  if (!existsSync(p)) { console.error(`missing ${label}: ${p}`); process.exit(1); }

const tmp = join(ROOT, `.tmp-${note}-regen`), FRAMES = join(tmp, "frames");
rmSync(tmp, { recursive: true, force: true }); mkdirSync(FRAMES, { recursive: true });

// Deterministically reconstruct the synced timeline from the same VO (matches the approved audio).
const speech = readSpeech(voPath);
const newTL = warpTimeline(cfg.TL, cfg.narrTimes, speech);
console.log(`#${note}: VO ${speech.voDur.toFixed(2)}s → timeline end ${newTL.end}s (brand ${newTL.brand}s)`);

// Render at the native viewport (renderFrames applies Emulation.setDeviceMetricsOverride → no white bar).
await renderFrames({ sceneFile: join(dir, cfg.sceneBasename), sceneBasename: cfg.sceneBasename, TL: newTL, port: cfg.port, framesDir: FRAMES });

// Thumbnail-first: first decoded frame = the generated cover.
embedThumbnailFrameZero({ framesDir: FRAMES, thumbPath });
console.log(`  thumbnail embedded as frame zero: ${thumbPath}`);

// Mux new frames + COPY the approved audio stream (byte-identical; no re-encode).
const out = join(dir, `field-note-${note}-final-vo-thumb.mp4`);
ff(["-framerate", String(FPS), "-i", join(FRAMES, "f_%05d.png"), "-i", approved,
  "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
  "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out]);

rmSync(tmp, { recursive: true, force: true });

// Verify: audio stream md5 identical to approved; durations close; frame-zero luma sane.
const amd5 = (f) => execSync(`ffmpeg -v error -i "${f}" -map 0:a:0 -f md5 -`).toString().trim();
const same = amd5(out) === amd5(approved);
console.log(`  audio-stream md5 ${same ? "IDENTICAL ✓" : "DIFFERENT ✗"} vs approved`);
console.log(`  duration approved ${dur(approved).toFixed(3)}s → new ${dur(out).toFixed(3)}s`);
console.log(`\n#${note} REGEN DONE (recommended posting file):\n  ${out}`);

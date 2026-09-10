// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — MEDIA PROBE (the I/O half of media timeline QA).
//
// This is the ONLY media file that touches ffprobe/ffmpeg and the filesystem. It
// takes a LOCAL mp4 path (or an http(s) URL — passed straight to ffmpeg, which reads
// remote input), probes container/stream metadata, extracts one JPEG still at each
// sample point across the runtime, measures each still's encoded size, and returns a
// plain `MediaProbe`. The verdict is then computed by the PURE assessMedia() in
// media-qa.ts — this module never decides PASS/BLOCK, it only gathers evidence.
//
// Cost-safe (§19): pure inspection of an already-rendered asset. It NEVER calls a paid
// provider, never renders, never re-encodes the source — it only decodes a handful of
// stills. Safe to run in the release gate and the Explainer QA gallery.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MEDIA_SAMPLE_PCTS, type MediaProbe, type FrameSample, type MediaOrientation } from "./media-qa";

const pExecFile = promisify(execFile);

export interface ProbeOptions {
  label: string;
  expectedOrientation?: MediaOrientation | null;
  motionExpected?: boolean;
  narrated?: boolean;
  minDurationSeconds?: number | null;
  /** Narration length (seconds) the visuals must cover — usually the audio duration. */
  audioDurationSeconds?: number | null;
  /** ffprobe/ffmpeg binaries (default: on PATH). */
  ffprobePath?: string;
  ffmpegPath?: string;
}

interface FfprobeStreams {
  streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
  format?: { duration?: string };
}

/** ffprobe → dimensions, total duration, audio presence + (best-effort) audio duration. */
async function probeMetadata(source: string, ffprobePath: string) {
  const { stdout } = await pExecFile(ffprobePath, [
    "-v", "error",
    "-show_entries", "stream=codec_type,width,height,duration:format=duration",
    "-of", "json",
    source,
  ], { maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(stdout) as FfprobeStreams;
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const fmtDur = parsed.format?.duration ? Number(parsed.format.duration) : null;
  const durationSeconds = fmtDur ?? (video?.duration ? Number(video.duration) : null);
  const audioDurationSeconds = audio?.duration ? Number(audio.duration) : null;
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
    hasAudioStream: !!audio,
    audioDurationSeconds,
  };
}

/** Extract a single JPEG still at `atSeconds` and return its encoded byte size. */
async function sampleFrame(source: string, atSeconds: number, outPath: string, ffmpegPath: string): Promise<number> {
  // -ss before -i = fast seek; one frame; overwrite. quiet.
  await pExecFile(ffmpegPath, [
    "-y", "-loglevel", "error",
    "-ss", atSeconds.toFixed(3),
    "-i", source,
    "-frames:v", "1",
    "-q:v", "3",
    outPath,
  ], { maxBuffer: 8 * 1024 * 1024 });
  try {
    const s = await stat(outPath);
    return s.size;
  } catch {
    return 0; // extraction failed → treated as a dead/empty frame downstream
  }
}

/**
 * Probe a rendered video into a `MediaProbe` ready for assessMedia().
 * `source` is a local file path or an http(s) URL. Cleans up its temp stills.
 */
export async function probeMedia(source: string, opts: ProbeOptions): Promise<MediaProbe> {
  const ffprobePath = opts.ffprobePath ?? "ffprobe";
  const ffmpegPath = opts.ffmpegPath ?? "ffmpeg";
  const meta = await probeMetadata(source, ffprobePath);

  const samples: FrameSample[] = [];
  const dir = await mkdtemp(join(tmpdir(), "breakbot-media-"));
  try {
    const duration = meta.durationSeconds ?? 0;
    // Keep the last sample safely inside the stream — seeking to the exact end lands
    // past the final frame and yields an empty extraction (false "blank" at 100%).
    const endGuard = duration > 0.6 ? duration - 0.3 : duration;
    for (const pct of MEDIA_SAMPLE_PCTS) {
      const at = duration > 0 ? Math.min(endGuard, (pct / 100) * duration) : 0;
      const out = join(dir, `f_${pct}.jpg`);
      const byteSize = duration > 0 ? await sampleFrame(source, Math.max(0, at), out, ffmpegPath) : 0;
      samples.push({ pct, atSeconds: Math.max(0, at), byteSize });
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    label: opts.label,
    width: meta.width,
    height: meta.height,
    durationSeconds: meta.durationSeconds,
    hasAudioStream: meta.hasAudioStream,
    audioDurationSeconds: opts.audioDurationSeconds ?? meta.audioDurationSeconds,
    samples,
    expectedOrientation: opts.expectedOrientation ?? null,
    motionExpected: opts.motionExpected ?? true,
    narrated: opts.narrated ?? true,
    minDurationSeconds: opts.minDurationSeconds ?? null,
  };
}

/** Read a local file's bytes (helper for callers that also want the raw asset). */
export async function readAssetBytes(path: string): Promise<Buffer> {
  return readFile(path);
}

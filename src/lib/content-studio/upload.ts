// Content Studio — audio upload validation (pure). Enforces documented type/size/duration limits so
// bad files are rejected clearly before they ever reach the renderer.

export const AUDIO_MAX_BYTES = 25 * 1024 * 1024; // 25 MB — a spoken 30–60s VO is well under this
export const AUDIO_MIN_SECONDS = 5;
export const AUDIO_MAX_SECONDS = 90;

// Accepted container/codecs for a manually-produced voiceover.
export const AUDIO_ACCEPT = [
  "audio/mpeg", // .mp3
  "audio/mp3",
  "audio/mp4", // .m4a
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
];

const EXT = /\.(mp3|m4a|aac|wav)$/i;

export interface UploadCheck {
  ok: boolean;
  reason?: string;
}

export function validateAudioMeta(input: {
  name: string;
  type: string;
  bytes: number;
  durationSeconds?: number | null;
}): UploadCheck {
  const { name, type, bytes, durationSeconds } = input;
  if (!bytes || bytes <= 0) return { ok: false, reason: "Empty file." };
  if (bytes > AUDIO_MAX_BYTES)
    return { ok: false, reason: `File is ${(bytes / 1024 / 1024).toFixed(1)} MB — the limit is 25 MB.` };
  const typeOk = type ? AUDIO_ACCEPT.includes(type.toLowerCase()) : false;
  const extOk = EXT.test(name);
  if (!typeOk && !extOk)
    return { ok: false, reason: "Unsupported audio format. Use MP3, M4A, AAC, or WAV." };
  if (durationSeconds != null) {
    if (durationSeconds < AUDIO_MIN_SECONDS)
      return { ok: false, reason: `Audio is ${durationSeconds.toFixed(1)}s — too short (min ${AUDIO_MIN_SECONDS}s).` };
    if (durationSeconds > AUDIO_MAX_SECONDS)
      return { ok: false, reason: `Audio is ${durationSeconds.toFixed(1)}s — too long (max ${AUDIO_MAX_SECONDS}s).` };
  }
  return { ok: true };
}

// A stable signature for a specific audio file, used in the render input-version.
export function audioSignature(input: { name: string; bytes: number; durationSeconds?: number | null }): string {
  return `${input.name}:${input.bytes}:${input.durationSeconds != null ? input.durationSeconds.toFixed(2) : "?"}`;
}

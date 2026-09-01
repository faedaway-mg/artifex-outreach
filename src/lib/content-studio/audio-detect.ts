// Content Studio — audio CONTENT detection (section I-A). The upload validator must trust the file's
// actual bytes, never its filename or the client-sent MIME header (both are trivially forged). This pure
// module sniffs the container/codec signature from the leading bytes and returns the real type, so a
// PNG/exe renamed to .mp3 (or sent as audio/mpeg) is rejected as corrupt. Covers the iPhone-realistic set:
// M4A/AAC (ISO-BMFF 'ftyp'), MP3 (ID3 tag or MPEG frame sync), WAV (RIFF/WAVE), raw AAC (ADTS).

export type AudioKindDetected = "mp3" | "m4a" | "aac" | "wav";

export interface DetectResult {
  ok: boolean;
  type: AudioKindDetected | null;
  mime: string | null;
  reason?: string;
}

const ascii = (b: Uint8Array, start: number, len: number): string => {
  let s = "";
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

// ISO-BMFF (MP4/M4A) brands we accept as audio. iPhone Voice Memos export 'M4A ' / 'mp42' / 'isom'.
const MP4_AUDIO_BRANDS = new Set(["M4A ", "M4B ", "mp42", "mp41", "isom", "iso2", "3gp4", "3gp5"]);

// Detect the real audio type from the leading bytes. `bytes` should be at least the first ~16 bytes.
export function detectAudioType(bytes: Uint8Array): DetectResult {
  if (!bytes || bytes.length < 12) return { ok: false, type: null, mime: null, reason: "File too small to be valid audio." };

  // WAV — "RIFF"…"WAVE"
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return { ok: true, type: "wav", mime: "audio/wav" };
  }

  // ISO-BMFF (MP4/M4A/AAC-in-mp4) — a 'ftyp' box at offset 4, with an accepted major brand.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (MP4_AUDIO_BRANDS.has(brand) || brand.startsWith("M4A") || brand.startsWith("mp4")) {
      return { ok: true, type: "m4a", mime: "audio/mp4" };
    }
    // A ftyp we don't recognise as audio (e.g. a video container) — refuse rather than guess.
    return { ok: false, type: null, mime: null, reason: `Unsupported MP4 brand "${brand.trim()}" — export an audio-only M4A.` };
  }

  // MP3 — an ID3v2 tag …
  if (ascii(bytes, 0, 3) === "ID3") {
    return { ok: true, type: "mp3", mime: "audio/mpeg" };
  }

  // … or a raw MPEG/ADTS frame sync (0xFFF…). Disambiguate ADTS-AAC from MP3 by the layer/protection bits.
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    // ADTS AAC: syncword 0xFFF, then the next 4 bits are MPEG-version(1) + layer(2 == 00) + protection(1).
    // (b1 & 0xF6) === 0xF0 means layer == 00 → AAC ADTS. Otherwise it's an MPEG-audio (MP3) frame.
    if ((bytes[1] & 0xf6) === 0xf0) return { ok: true, type: "aac", mime: "audio/aac" };
    return { ok: true, type: "mp3", mime: "audio/mpeg" };
  }

  return { ok: false, type: null, mime: null, reason: "Not a recognised audio file (no MP3/M4A/AAC/WAV signature)." };
}

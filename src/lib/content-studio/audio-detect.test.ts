import { describe, it, expect } from "vitest";
import { detectAudioType } from "./audio-detect";

// Build a 16+ byte header from an ASCII/byte spec.
function hdr(spec: Array<string | number>): Uint8Array {
  const out: number[] = [];
  for (const s of spec) {
    if (typeof s === "number") out.push(s);
    else for (const ch of s) out.push(ch.charCodeAt(0));
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
}

describe("audio content detection (section I-A)", () => {
  it("detects WAV (RIFF/WAVE)", () => {
    const r = detectAudioType(hdr(["RIFF", 0x24, 0x00, 0x00, 0x00, "WAVE"]));
    expect(r).toMatchObject({ ok: true, type: "wav" });
  });

  it("detects M4A / MP4 audio (ftyp + audio brand)", () => {
    expect(detectAudioType(hdr([0, 0, 0, 0x20, "ftyp", "M4A "]))).toMatchObject({ ok: true, type: "m4a" });
    expect(detectAudioType(hdr([0, 0, 0, 0x18, "ftyp", "mp42"]))).toMatchObject({ ok: true, type: "m4a" });
    expect(detectAudioType(hdr([0, 0, 0, 0x18, "ftyp", "isom"]))).toMatchObject({ ok: true, type: "m4a" });
  });

  it("detects MP3 via ID3 tag and via frame sync", () => {
    expect(detectAudioType(hdr(["ID3", 0x03, 0x00]))).toMatchObject({ ok: true, type: "mp3" });
    expect(detectAudioType(hdr([0xff, 0xfb, 0x90, 0x00]))).toMatchObject({ ok: true, type: "mp3" });
  });

  it("detects raw AAC (ADTS frame sync)", () => {
    expect(detectAudioType(hdr([0xff, 0xf1, 0x50, 0x80]))).toMatchObject({ ok: true, type: "aac" });
  });

  it("REJECTS a forged MIME — real bytes are a PNG renamed .mp3", () => {
    const png = detectAudioType(hdr([0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.ok).toBe(false);
    expect(png.type).toBeNull();
  });

  it("REJECTS a corrupt/truncated file", () => {
    expect(detectAudioType(new Uint8Array([0x00, 0x01, 0x02])).ok).toBe(false);
    expect(detectAudioType(hdr(["JUNKDATA1234"])).ok).toBe(false);
  });

  it("REJECTS a non-audio MP4 brand (video container)", () => {
    const r = detectAudioType(hdr([0, 0, 0, 0x20, "ftyp", "qt  "]));
    expect(r.ok).toBe(false);
    expect(r.type).toBeNull();
  });
});

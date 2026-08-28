import { describe, it, expect } from "vitest";
import { validateAudioMeta, audioSignature, AUDIO_MAX_BYTES } from "./upload";

describe("validateAudioMeta", () => {
  it("accepts a normal mp3 voiceover", () => {
    expect(validateAudioMeta({ name: "vo.mp3", type: "audio/mpeg", bytes: 900_000, durationSeconds: 28 }).ok).toBe(true);
  });
  it("accepts by extension when the browser sends no type", () => {
    expect(validateAudioMeta({ name: "vo.m4a", type: "", bytes: 500_000, durationSeconds: 30 }).ok).toBe(true);
  });
  it("rejects unsupported formats", () => {
    const r = validateAudioMeta({ name: "clip.mov", type: "video/quicktime", bytes: 1000, durationSeconds: 20 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Unsupported/);
  });
  it("rejects oversize files", () => {
    const r = validateAudioMeta({ name: "big.wav", type: "audio/wav", bytes: AUDIO_MAX_BYTES + 1, durationSeconds: 30 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/limit is 25 MB/);
  });
  it("rejects too-short and too-long audio", () => {
    expect(validateAudioMeta({ name: "a.mp3", type: "audio/mpeg", bytes: 1000, durationSeconds: 2 }).ok).toBe(false);
    expect(validateAudioMeta({ name: "a.mp3", type: "audio/mpeg", bytes: 1000, durationSeconds: 120 }).ok).toBe(false);
  });
  it("passes when duration is unknown (validated later)", () => {
    expect(validateAudioMeta({ name: "a.mp3", type: "audio/mpeg", bytes: 1000, durationSeconds: null }).ok).toBe(true);
  });
  it("rejects empty files", () => {
    expect(validateAudioMeta({ name: "a.mp3", type: "audio/mpeg", bytes: 0 }).ok).toBe(false);
  });
});

describe("audioSignature", () => {
  it("changes with any field", () => {
    const a = audioSignature({ name: "vo.mp3", bytes: 100, durationSeconds: 30 });
    expect(a).toBe("vo.mp3:100:30.00");
    expect(audioSignature({ name: "vo.mp3", bytes: 101, durationSeconds: 30 })).not.toBe(a);
  });
});

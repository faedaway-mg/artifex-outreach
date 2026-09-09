// ─────────────────────────────────────────────────────────────────────────────
// VOICE CONFIG — the ElevenLabs config seam. These tests NEVER hit the real API:
// they only read process.env-shaped inputs and assert the safe/observable shapes.
// The load-bearing security property is that publicElevenLabsConfig can NEVER leak
// the API key or the raw voice ID (mandate #2).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  getElevenLabsConfig,
  elevenLabsConfigured,
  publicElevenLabsConfig,
} from "./elevenlabs-config";

const KEY = "sk-super-secret-key-value-abc123";
const VOICE = "raw-voice-id-xyz789";

function env(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  // A hermetic env — never the process's real env, so we can't accidentally read a
  // real key and can't be affected by ambient config.
  return { ...over } as NodeJS.ProcessEnv;
}

describe("elevenLabsConfigured (mandate #1: missing config)", () => {
  it("is false when neither key nor voice is present", () => {
    expect(elevenLabsConfigured(env())).toBe(false);
  });

  it("is false when the key is present but the voice ID is missing", () => {
    expect(elevenLabsConfigured(env({ ELEVENLABS_API_KEY: KEY }))).toBe(false);
  });

  it("is false when the voice ID is present but the key is missing", () => {
    expect(elevenLabsConfigured(env({ ELEVENLABS_VOICE_ID: VOICE }))).toBe(false);
  });

  it("is false when values are only whitespace (trimmed to empty)", () => {
    expect(elevenLabsConfigured(env({ ELEVENLABS_API_KEY: "   ", ELEVENLABS_VOICE_ID: "  " }))).toBe(false);
  });

  it("is true only when BOTH key and voice ID are present", () => {
    expect(elevenLabsConfigured(env({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: VOICE }))).toBe(true);
  });
});

describe("getElevenLabsConfig", () => {
  it("returns the secret key + voice for server-side request construction", () => {
    const c = getElevenLabsConfig(env({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: VOICE }));
    expect(c.apiKey).toBe(KEY);
    expect(c.voiceId).toBe(VOICE);
  });

  it("defaults the non-secret model/format knobs when absent", () => {
    const c = getElevenLabsConfig(env({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: VOICE }));
    expect(c.modelId).toBe("eleven_multilingual_v2");
    expect(c.outputFormat).toBe("mp3_44100_128");
  });

  it("honors explicit model/format overrides", () => {
    const c = getElevenLabsConfig(
      env({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: VOICE, ELEVENLABS_MODEL_ID: "custom_model", ELEVENLABS_OUTPUT_FORMAT: "mp3_22050_32" }),
    );
    expect(c.modelId).toBe("custom_model");
    expect(c.outputFormat).toBe("mp3_22050_32");
  });
});

describe("publicElevenLabsConfig (mandate #2: never leaks key/voiceId)", () => {
  it("reports booleans + non-secret knobs, never the raw values", () => {
    const pub = publicElevenLabsConfig(env({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: VOICE }));
    expect(pub).toEqual({
      configured: true,
      hasApiKey: true,
      hasVoiceId: true,
      modelId: "eleven_multilingual_v2",
      outputFormat: "mp3_44100_128",
    });
  });

  it("no property's value equals the API key or the raw voice ID (deep scan)", () => {
    const pub = publicElevenLabsConfig(env({ ELEVENLABS_API_KEY: KEY, ELEVENLABS_VOICE_ID: VOICE }));
    const serialized = JSON.stringify(pub);
    // Neither secret may appear anywhere in the serialized public shape.
    expect(serialized.includes(KEY)).toBe(false);
    expect(serialized.includes(VOICE)).toBe(false);
    // And no individual value equals a secret.
    for (const v of Object.values(pub)) {
      expect(v).not.toBe(KEY);
      expect(v).not.toBe(VOICE);
    }
  });

  it("hasApiKey/hasVoiceId flip correctly when missing (still no leak)", () => {
    const pub = publicElevenLabsConfig(env());
    expect(pub.configured).toBe(false);
    expect(pub.hasApiKey).toBe(false);
    expect(pub.hasVoiceId).toBe(false);
    expect(JSON.stringify(pub).includes(KEY)).toBe(false);
  });
});

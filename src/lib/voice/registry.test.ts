// ─────────────────────────────────────────────────────────────────────────────
// VOICE REGISTRY — the canonical voice set. These tests pin the Matt default and the
// Lucas legacy contract: Matt is the current-matt generation (ElevenLabs, resolvable),
// Lucas is legacy-lucas with NO invented provider ID (resolveVoiceId → null) and is
// never "available". Journey resolution never silently returns a social voice.
// Deterministic: a hermetic env is passed everywhere a value is resolved.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  DEFAULT_VOICE_KEY,
  LEGACY_LUCAS_VOICE_KEY,
  journeyVoices,
  publicVoice,
  resolveVoiceId,
  voiceGeneration,
  sameVoiceGeneration,
  resolveJourneyVoiceKey,
  voiceDisplayName,
} from "./registry";

const CONFIGURED = { ELEVENLABS_API_KEY: "test-key", ELEVENLABS_VOICE_ID: "test-voice" } as unknown as NodeJS.ProcessEnv;
const UNCONFIGURED = {} as NodeJS.ProcessEnv;

describe("default Matt resolution (mandate #3)", () => {
  it("resolveJourneyVoiceKey(undefined) is the Matt default key", () => {
    expect(resolveJourneyVoiceKey(undefined)).toBe(DEFAULT_VOICE_KEY);
    expect(DEFAULT_VOICE_KEY).toBe("artifex_default");
  });

  it("resolveJourneyVoiceKey(null | '') falls back to the Matt default", () => {
    expect(resolveJourneyVoiceKey(null)).toBe(DEFAULT_VOICE_KEY);
    expect(resolveJourneyVoiceKey("")).toBe(DEFAULT_VOICE_KEY);
  });

  it("an unknown requested key falls back to the Matt default (never a social leak)", () => {
    expect(resolveJourneyVoiceKey("some_social_experiment")).toBe(DEFAULT_VOICE_KEY);
  });

  it("voiceDisplayName(DEFAULT_VOICE_KEY) === 'Matt'", () => {
    expect(voiceDisplayName(DEFAULT_VOICE_KEY)).toBe("Matt");
  });

  it("Matt is the current-matt generation and resolves its ID from env", () => {
    expect(voiceGeneration(DEFAULT_VOICE_KEY)).toBe("current-matt");
    expect(resolveVoiceId(DEFAULT_VOICE_KEY, CONFIGURED)).toBe("test-voice");
    // No env voice → NO invented ID (null), never a fallback literal.
    expect(resolveVoiceId(DEFAULT_VOICE_KEY, UNCONFIGURED)).toBeNull();
  });
});

describe("Lucas legacy contract (mandate #4)", () => {
  it("legacy_lucas is the legacy-lucas generation", () => {
    expect(voiceGeneration(LEGACY_LUCAS_VOICE_KEY)).toBe("legacy-lucas");
    expect(LEGACY_LUCAS_VOICE_KEY).toBe("legacy_lucas");
  });

  it("resolveVoiceId('legacy_lucas') === null — NO fake ID, even when env is configured", () => {
    expect(resolveVoiceId(LEGACY_LUCAS_VOICE_KEY, CONFIGURED)).toBeNull();
    expect(resolveVoiceId(LEGACY_LUCAS_VOICE_KEY, UNCONFIGURED)).toBeNull();
  });

  it("publicVoice(legacy_lucas) is legacy:true and available:false (never generatable)", () => {
    const pub = publicVoice(LEGACY_LUCAS_VOICE_KEY, CONFIGURED)!;
    expect(pub).not.toBeNull();
    expect(pub.legacy).toBe(true);
    expect(pub.available).toBe(false);
    expect(pub.provider).toBe("legacy");
    expect(pub.generation).toBe("legacy-lucas");
  });

  it("publicVoice never exposes a raw voice ID for any voice", () => {
    const matt = publicVoice(DEFAULT_VOICE_KEY, CONFIGURED)!;
    expect(JSON.stringify(matt).includes("test-voice")).toBe(false);
    expect("voiceId" in (matt as any)).toBe(false);
  });
});

describe("generation coherence (mandate #5)", () => {
  it("sameVoiceGeneration(Matt, Matt) is true", () => {
    expect(sameVoiceGeneration(DEFAULT_VOICE_KEY, DEFAULT_VOICE_KEY)).toBe(true);
  });

  it("sameVoiceGeneration(Matt, Lucas) is false — journeys never silently mix", () => {
    expect(sameVoiceGeneration(DEFAULT_VOICE_KEY, LEGACY_LUCAS_VOICE_KEY)).toBe(false);
  });

  it("sameVoiceGeneration with an unknown key is false (no generation)", () => {
    expect(sameVoiceGeneration(DEFAULT_VOICE_KEY, "nope")).toBe(false);
  });
});

describe("publicVoice / Matt availability", () => {
  it("Matt is available when configured, unavailable when not (no fabricated availability)", () => {
    expect(publicVoice(DEFAULT_VOICE_KEY, CONFIGURED)!.available).toBe(true);
    expect(publicVoice(DEFAULT_VOICE_KEY, UNCONFIGURED)!.available).toBe(false);
  });

  it("publicVoice for an unknown key is null", () => {
    expect(publicVoice("unknown_key", CONFIGURED)).toBeNull();
  });
});

describe("journeyVoices", () => {
  it("returns only journey-scoped voices and includes both Matt and Lucas", () => {
    const keys = journeyVoices(CONFIGURED).map((v) => v.key);
    expect(keys).toContain(DEFAULT_VOICE_KEY);
    expect(keys).toContain(LEGACY_LUCAS_VOICE_KEY);
    // No social voices leak into the journey list.
    for (const v of journeyVoices(CONFIGURED)) expect(v.scope).toBe("journey");
  });
});

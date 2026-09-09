// ─────────────────────────────────────────────────────────────────────────────
// ELEVENLABS CONFIG — the ONE place the server reads ElevenLabs configuration.
//
// SECURITY: the API key is read here and NEVER returned by any function that could
// reach a log, a response, or the browser. getElevenLabsConfig() returns the key for
// server-side request construction ONLY; keyPresent()/publicConfig() are the safe
// shapes for anything observable. We never invent a voice ID — the canonical Matt
// voice is whatever ELEVENLABS_VOICE_ID holds; if it is absent, the provider is simply
// not configured (no fallback literal, no silent substitution).
// ─────────────────────────────────────────────────────────────────────────────

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
}

// Sane transport defaults ONLY for the non-secret model/format knobs. The voice ID is
// deliberately NOT defaulted — a wrong voice must never be silently substituted.
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

/** Read the full server-side config (INCLUDING the secret key). Server-only callers. */
export function getElevenLabsConfig(env: NodeJS.ProcessEnv = process.env): ElevenLabsConfig {
  return {
    apiKey: (env.ELEVENLABS_API_KEY ?? "").trim(),
    voiceId: (env.ELEVENLABS_VOICE_ID ?? "").trim(),
    modelId: (env.ELEVENLABS_MODEL_ID ?? "").trim() || DEFAULT_MODEL_ID,
    outputFormat: (env.ELEVENLABS_OUTPUT_FORMAT ?? "").trim() || DEFAULT_OUTPUT_FORMAT,
  };
}

/** True when a real generation could be attempted (key + voice present). Never leaks values. */
export function elevenLabsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = getElevenLabsConfig(env);
  return c.apiKey.length > 0 && c.voiceId.length > 0;
}

/** The safe, observable view — booleans + non-secret knobs. NEVER the key, NEVER the raw voiceId. */
export function publicElevenLabsConfig(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  hasApiKey: boolean;
  hasVoiceId: boolean;
  modelId: string;
  outputFormat: string;
} {
  const c = getElevenLabsConfig(env);
  return {
    configured: elevenLabsConfigured(env),
    hasApiKey: c.apiKey.length > 0,
    hasVoiceId: c.voiceId.length > 0,
    modelId: c.modelId,
    outputFormat: c.outputFormat,
  };
}

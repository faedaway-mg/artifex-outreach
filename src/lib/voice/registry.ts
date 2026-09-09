// ─────────────────────────────────────────────────────────────────────────────
// VOICE REGISTRY — the canonical set of Artifex voices, keyed so the rest of the
// system references a voice by KEY (artifex_default), never by a raw provider ID.
//
// Matt is the canonical default: `artifex_default` → displayName "Matt", provider
// elevenlabs, voiceId read from ELEVENLABS_VOICE_ID (never invented). The registry
// separates JOURNEY voices (the customer-facing prospect journey — outbound sales)
// from SOCIAL voices (future social-content experiments): a journey lookup can NEVER
// return a social voice, so a social experiment can never mutate a prospect's
// assigned Acquisition OS voice. Adding future voices (southern/alternate/female/
// social) is a data addition here — no refactor.
//
// The raw ElevenLabs voice ID is resolved lazily from env and is exposed ONLY via
// resolveVoiceId() (server-side, for request construction). The operator-facing
// publicVoice() shape never includes it.
// ─────────────────────────────────────────────────────────────────────────────
import { getElevenLabsConfig } from "./elevenlabs-config";

export type VoiceScope = "journey" | "social";
// "elevenlabs" = live-generatable via ElevenLabs. "legacy" = an existing voice whose
// assets remain valid but which has NO live generation provider (e.g. Lucas): we never
// invent a provider voice ID for it and never generate new audio for it.
export type VoiceProviderId = "elevenlabs" | "legacy";

// Two coherent generations of the Artifex experience. A prospect journey resolves to
// exactly ONE generation and is never silently mixed. Matt is the default for anything
// newly generated from now on; Lucas is preserved as a legacy generation.
export type VoiceGeneration = "current-matt" | "legacy-lucas";

export interface VoiceDefinition {
  /** Stable key referenced across the product (e.g. "artifex_default"). */
  key: string;
  displayName: string;
  provider: VoiceProviderId;
  scope: VoiceScope;
  generation: VoiceGeneration;
  /** How the raw provider voice ID is sourced — null for a legacy voice (never invented). */
  voiceIdSource: { kind: "env"; envVar: string } | null;
  active: boolean;
}

/** The canonical default voice key — Matt, the Artifex identity for NEW prospect journeys. */
export const DEFAULT_VOICE_KEY = "artifex_default";
/** The legacy Lucas voice key — existing Lucas journeys resolve here; NOT generatable. */
export const LEGACY_LUCAS_VOICE_KEY = "legacy_lucas";

// The registry. Two journey generations: Matt (current, ElevenLabs-generatable) and
// Lucas (legacy, preserved, NOT generatable — no ElevenLabs voice ID is ever invented
// for it). Social profiles would be added with scope:"social" and are never returned by
// journey lookups. Matt's ID lives in ELEVENLABS_VOICE_ID; Lucas has no live provider.
const REGISTRY: VoiceDefinition[] = [
  {
    key: DEFAULT_VOICE_KEY,
    displayName: "Matt",
    provider: "elevenlabs",
    scope: "journey",
    generation: "current-matt",
    voiceIdSource: { kind: "env", envVar: "ELEVENLABS_VOICE_ID" },
    active: true,
  },
  {
    key: LEGACY_LUCAS_VOICE_KEY,
    displayName: "Lucas — Legacy",
    provider: "legacy",
    scope: "journey",
    generation: "legacy-lucas",
    // No env source: Lucas cannot be generated through ElevenLabs and we never invent an ID.
    voiceIdSource: null,
    active: true,
  },
];

/** The safe, operator-facing shape — never includes the raw provider voice ID. */
export interface PublicVoice {
  key: string;
  displayName: string;
  provider: VoiceProviderId;
  scope: VoiceScope;
  generation: VoiceGeneration;
  active: boolean;
  /** True when this voice can GENERATE new audio right now (elevenlabs + configured). */
  available: boolean;
  /** True for a legacy voice: assets remain valid but no new audio is generated. */
  legacy: boolean;
}

function voiceDef(key: string): VoiceDefinition | null {
  return REGISTRY.find((v) => v.key === key) ?? null;
}

/** Resolve the raw provider voice ID for a voice key — SERVER-ONLY (request construction).
 *  Returns null for a legacy voice (no source) or when the source env var is absent
 *  (never invents an ID). */
export function resolveVoiceId(key: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const def = voiceDef(key);
  if (!def || !def.voiceIdSource) return null;
  const raw = (env[def.voiceIdSource.envVar] ?? "").trim();
  return raw.length > 0 ? raw : null;
}

/** Whether a voice key can GENERATE new audio right now. A legacy voice is never
 *  generatable (its existing assets stay valid, but no new audio is produced for it). */
export function voiceAvailable(key: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const def = voiceDef(key);
  if (!def || !def.active) return false;
  if (def.provider === "elevenlabs") {
    const cfg = getElevenLabsConfig(env);
    return cfg.apiKey.length > 0 && !!resolveVoiceId(key, env);
  }
  return false; // legacy (and any non-generatable provider)
}

/** Which coherent generation a voice key belongs to (current-matt | legacy-lucas). */
export function voiceGeneration(key: string): VoiceGeneration | null {
  return voiceDef(key)?.generation ?? null;
}

/** Whether two voice keys belong to the SAME journey generation (coherence check). */
export function sameVoiceGeneration(a: string, b: string): boolean {
  const ga = voiceGeneration(a);
  const gb = voiceGeneration(b);
  return ga != null && gb != null && ga === gb;
}

function toPublic(def: VoiceDefinition, env: NodeJS.ProcessEnv): PublicVoice {
  return {
    key: def.key,
    displayName: def.displayName,
    provider: def.provider,
    scope: def.scope,
    generation: def.generation,
    active: def.active,
    available: voiceAvailable(def.key, env),
    legacy: def.provider === "legacy",
  };
}

/** The operator-facing view of a voice (no raw IDs). Null when the key is unknown. */
export function publicVoice(key: string, env: NodeJS.ProcessEnv = process.env): PublicVoice | null {
  const def = voiceDef(key);
  return def ? toPublic(def, env) : null;
}

/** All JOURNEY voices the operator may select for a lead (social voices excluded). */
export function journeyVoices(env: NodeJS.ProcessEnv = process.env): PublicVoice[] {
  return REGISTRY.filter((v) => v.scope === "journey" && v.active).map((v) => toPublic(v, env));
}

/**
 * Normalize a requested voice key for a customer JOURNEY: return it only if it is a
 * known ACTIVE journey voice; otherwise fall back to the canonical default. A social
 * voice key can NEVER be used on a lead journey (returns the default instead), so a
 * social experiment can't leak into a prospect's assigned voice.
 */
export function resolveJourneyVoiceKey(requested: string | null | undefined): string {
  if (!requested) return DEFAULT_VOICE_KEY;
  const def = voiceDef(requested);
  if (def && def.scope === "journey" && def.active) return def.key;
  return DEFAULT_VOICE_KEY;
}

/** The display name for a voice key (for operator UI). Falls back to the key itself. */
export function voiceDisplayName(key: string): string {
  return voiceDef(key)?.displayName ?? key;
}

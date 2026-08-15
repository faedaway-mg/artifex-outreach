// ─────────────────────────────────────────────────────────────────────────────
// Voice provider boundary — the Quick Review Content Engine's ONLY coupling point to how narration
// audio is produced. The rest of the system (narration, scene timing, the future renderer) depends on
// this contract, never on VEED. That means the way we acquire the "Lucas" voice can change — a direct
// API, an upstream provider, or a manual VEED bridge — without touching story, timing, or rendering.
//
// Hard rule: a provider NEVER silently substitutes a different voice. If the exact voice isn't
// available programmatically, generate() returns a VOICE_REQUIRED state describing the one manual step,
// and the operator's exported audio re-enters through importNarrationAudio(). No fallback narrator.
// ─────────────────────────────────────────────────────────────────────────────
import type { NarrationScript } from "./narration";

/** The audio artifact every downstream stage consumes — provider-agnostic. */
export interface NarrationAudio {
  /** Path/URI to the audio file (local artifact; never a VEED project link). */
  file: string;
  durationSeconds: number;
  /** Provider id that produced it (e.g. "manual-veed-lucas", "upstream-…"). */
  provider: string;
  /** The voice identity (must be the exact intended voice — "Lucas"). */
  voice: string;
  /** When it was produced; null for deterministic contexts (caller stamps it). */
  generatedAt: string | null;
  metadata?: Record<string, unknown>;
}

/** The result of asking a provider to narrate a script: either finished audio, or a manual step. */
export type VoiceResult =
  | { status: "ready"; audio: NarrationAudio }
  | {
      status: "voice-required";
      provider: string;
      voice: string;
      /** One clean block the operator pastes into the voice tool. */
      copyBlock: string;
      /** The minimal, ordered manual steps to produce the audio. */
      instructions: string[];
      /** The narration's target length, so the operator can sanity-check pacing. */
      targetSeconds: number;
    };

export interface GenerateOptions {
  /** Words-per-minute to target when estimating length (voice-specific once measured). */
  wpm?: number;
}

/** The provider contract. `mode` tells the UI whether to show a spinner or the manual handoff. */
export interface VoiceProvider {
  id: string;
  voice: string;
  mode: "programmatic" | "manual";
  generate(script: NarrationScript, opts?: GenerateOptions): Promise<VoiceResult>;
}

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|mp4)$/i;

/** The import boundary: normalize an operator-supplied (or programmatically produced) audio file into
 *  a NarrationAudio, validating it before it enters timing/rendering. Fails safely on bad input —
 *  never invents a duration and never accepts a non-audio file. Pure (duration is supplied by the
 *  caller, e.g. from ffprobe) so the contract is testable without a media dependency. */
export function importNarrationAudio(input: {
  file: string;
  durationSeconds: number;
  voice: string;
  provider?: string;
  generatedAt?: string | null;
  metadata?: Record<string, unknown>;
}): NarrationAudio {
  if (!input.file || !AUDIO_EXT.test(input.file)) throw new Error(`not an audio file: ${input.file || "(empty)"}`);
  if (!(input.durationSeconds > 0) || !Number.isFinite(input.durationSeconds)) throw new Error(`invalid audio duration: ${input.durationSeconds}`);
  if (!input.voice) throw new Error("voice identity is required — narration audio must name its voice");
  return {
    file: input.file,
    durationSeconds: input.durationSeconds,
    provider: input.provider ?? "imported",
    voice: input.voice,
    generatedAt: input.generatedAt ?? null,
    metadata: input.metadata,
  };
}

/** The realistic Lucas path today: the voice lives in the VEED editor with no legitimate programmatic
 *  interface, so we automate everything except the voice. generate() hands back the one copy block and
 *  the exact steps; ingest() accepts the exported audio through the same boundary as any provider. */
export class ManualLucasProvider implements VoiceProvider {
  id = "manual-veed-lucas";
  voice = "Lucas";
  mode = "manual" as const;

  async generate(script: NarrationScript, opts: GenerateOptions = {}): Promise<VoiceResult> {
    return {
      status: "voice-required",
      provider: this.id,
      voice: this.voice,
      copyBlock: script.copyBlock,
      instructions: [
        "Open VEED (veed.io) and start a Text to Speech clip",
        "Choose the Lucas voice",
        "Paste the copied script",
        "Generate, then export/download the narration audio",
        "Drop the audio file back into Acquisition OS",
      ],
      targetSeconds: script.estDurationSeconds(opts.wpm),
    };
  }

  /** Accept the operator's exported Lucas audio and satisfy the provider boundary. */
  ingest(file: string, durationSeconds: number, generatedAt: string | null = null): NarrationAudio {
    return importNarrationAudio({ file, durationSeconds, voice: this.voice, provider: this.id, generatedAt });
  }
}

/** Placeholder for a future legitimate programmatic route (VEED API or a confirmed upstream provider).
 *  Kept unimplemented ON PURPOSE: wiring it must NOT change narration/timing/rendering — only this
 *  class fills in. It throws until a verified exact-voice API exists, so nothing silently degrades. */
export class ProgrammaticLucasProvider implements VoiceProvider {
  id: string;
  voice = "Lucas";
  mode = "programmatic" as const;
  constructor(id = "programmatic-lucas-unconfigured") { this.id = id; }
  async generate(): Promise<VoiceResult> {
    throw new Error("No verified programmatic Lucas voice API is configured. Use ManualLucasProvider until one is confirmed.");
  }
}

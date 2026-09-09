// ─────────────────────────────────────────────────────────────────────────────
// VOICE PROVIDER — the typed boundary so ElevenLabs is not scattered through the
// codebase. Content Studio, the renderer, and the orchestrator depend on this
// interface, never on fetch("elevenlabs.io") directly, so a future provider slots
// in without a rewrite.
//
// SECURITY: the API key is used ONLY to build the request header here. It is NEVER
// included in a thrown error, a returned object, a log line, or any persisted field.
// Error messages are sanitized to status + provider text with any key-shaped token
// scrubbed. All calls are server-side.
// ─────────────────────────────────────────────────────────────────────────────
import { getElevenLabsConfig } from "./elevenlabs-config";

export interface GenerateVoiceoverInput {
  /** The exact narration text to speak (authoritative script). */
  text: string;
  /** Raw provider voice ID (resolved from the registry by the caller — server-side). */
  voiceId: string;
  modelId: string;
  outputFormat: string;
  /** Lineage only — never sent as anything customer-facing. */
  leadId: string;
  narrationId: string;
}

export interface GenerateVoiceoverResult {
  audio: Buffer;
  contentType: string;
  bytes: number;
  characterCount: number;
  provider: string;
  modelId: string;
  outputFormat: string;
  /** Provider request id when the provider returns one (for audit); null otherwise. */
  requestId: string | null;
}

/** A stable, non-secret error classification so callers can decide retry vs fail. */
export type VoiceProviderErrorKind =
  | "not_configured"
  | "bad_request" // 4xx that won't fix on retry (bad voice/model/text)
  | "unauthorized" // 401/403 — bad key/permissions
  | "rate_limited" // 429
  | "server_error" // 5xx
  | "timeout"
  | "empty_audio"
  | "network";

export class VoiceProviderError extends Error {
  kind: VoiceProviderErrorKind;
  status: number | null;
  retryable: boolean;
  constructor(kind: VoiceProviderErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "VoiceProviderError";
    this.kind = kind;
    this.status = status;
    this.retryable = kind === "rate_limited" || kind === "server_error" || kind === "timeout" || kind === "network";
  }
}

export interface VoiceProvider {
  id: string;
  generateVoiceover(input: GenerateVoiceoverInput): Promise<GenerateVoiceoverResult>;
}

// Scrub anything key-shaped from a string before it can reach an error/log. ElevenLabs
// keys are opaque tokens; we redact long alnum/underscore runs defensively.
function scrubSecrets(s: string, apiKey: string): string {
  let out = s;
  if (apiKey) out = out.split(apiKey).join("[redacted]");
  return out.replace(/\b(sk|xi)[-_][A-Za-z0-9]{12,}\b/g, "[redacted]");
}

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export interface ElevenLabsProviderOptions {
  timeoutMs?: number;
  /** Injectable fetch for tests — defaults to global fetch. Never used to bypass the key in prod. */
  fetchImpl?: typeof fetch;
}

export class ElevenLabsVoiceProvider implements VoiceProvider {
  id = "elevenlabs";
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(opts: ElevenLabsProviderOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async generateVoiceover(input: GenerateVoiceoverInput): Promise<GenerateVoiceoverResult> {
    const cfg = getElevenLabsConfig();
    if (!cfg.apiKey) throw new VoiceProviderError("not_configured", "ELEVENLABS_API_KEY is not configured");
    if (!input.voiceId) throw new VoiceProviderError("not_configured", "No voice ID resolved for the requested voice");
    if (!input.text || !input.text.trim()) throw new VoiceProviderError("bad_request", "Narration text is empty");

    const url = `${ELEVENLABS_TTS_URL}/${encodeURIComponent(input.voiceId)}?output_format=${encodeURIComponent(input.outputFormat)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "xi-api-key": cfg.apiKey,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({ text: input.text, model_id: input.modelId }),
        signal: controller.signal,
      });
    } catch (e) {
      const msg = scrubSecrets((e as Error)?.message ?? "network error", cfg.apiKey);
      if ((e as Error)?.name === "AbortError") throw new VoiceProviderError("timeout", `ElevenLabs request timed out after ${this.timeoutMs}ms`);
      throw new VoiceProviderError("network", `ElevenLabs request failed: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let bodyText = "";
      try {
        bodyText = scrubSecrets((await res.text()).slice(0, 500), cfg.apiKey);
      } catch {
        bodyText = "";
      }
      const kind: VoiceProviderErrorKind =
        res.status === 401 || res.status === 403
          ? "unauthorized"
          : res.status === 429
            ? "rate_limited"
            : res.status >= 500
              ? "server_error"
              : "bad_request";
      throw new VoiceProviderError(kind, `ElevenLabs returned ${res.status}: ${bodyText}`, res.status);
    }

    const arr = Buffer.from(await res.arrayBuffer());
    if (!arr || arr.byteLength === 0) throw new VoiceProviderError("empty_audio", "ElevenLabs returned an empty audio body");

    return {
      audio: arr,
      contentType: res.headers.get("content-type") ?? "audio/mpeg",
      bytes: arr.byteLength,
      characterCount: input.text.length,
      provider: this.id,
      modelId: input.modelId,
      outputFormat: input.outputFormat,
      requestId: res.headers.get("request-id") ?? res.headers.get("x-request-id"),
    };
  }
}

/**
 * A deterministic mock provider for the test suite — produces a tiny non-empty
 * synthetic MP3-ish buffer whose size scales with text length so duration probing
 * downstream stays deterministic. NEVER used when a real key is present unless a test
 * injects it explicitly. Consumes ZERO provider credits.
 */
export class MockVoiceProvider implements VoiceProvider {
  id = "mock";
  private failWith: VoiceProviderError | null;
  constructor(opts: { failWith?: VoiceProviderError } = {}) {
    this.failWith = opts.failWith ?? null;
  }
  async generateVoiceover(input: GenerateVoiceoverInput): Promise<GenerateVoiceoverResult> {
    if (this.failWith) throw this.failWith;
    if (!input.text.trim()) throw new VoiceProviderError("bad_request", "Narration text is empty");
    // A minimal valid-ish MP3 frame header + padding sized by text length (deterministic).
    const header = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
    const body = Buffer.alloc(Math.max(64, input.text.length * 8), 0);
    const audio = Buffer.concat([header, body]);
    return {
      audio,
      contentType: "audio/mpeg",
      bytes: audio.byteLength,
      characterCount: input.text.length,
      provider: this.id,
      modelId: input.modelId,
      outputFormat: input.outputFormat,
      requestId: "mock-req",
    };
  }
}

// Test-injection seam: the orchestrator resolves its provider through here so the
// suite can force the mock without a real key and prod always gets the real adapter.
let _injected: VoiceProvider | null = null;
export function __setVoiceProviderForTests(p: VoiceProvider | null): void {
  _injected = p;
}
export function getVoiceProvider(providerId: string = "elevenlabs"): VoiceProvider {
  if (_injected) return _injected;
  if (providerId === "elevenlabs") return new ElevenLabsVoiceProvider();
  if (providerId === "mock") return new MockVoiceProvider();
  throw new Error(`unknown voice provider: ${providerId}`);
}

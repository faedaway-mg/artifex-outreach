// ─────────────────────────────────────────────────────────────────────────────
// ELEVENLABS PROVIDER BALANCE — best-effort, FAIL-OPEN read of the account cycle
// (mandate C §10/§11). Reads /v1/user/subscription with the server-side key and
// returns a safe ProviderBalance (characters remaining/limit, reset, an estimated
// minutes-remaining). NEVER throws, NEVER leaks the key, NEVER blocks a render: any
// error / missing key / non-200 → null (the Capacity Manager then falls back to the
// configured allowance + measured usage and honestly reports the provider value as
// unavailable). This is a free metadata GET, not a generation — it consumes no credits.
// ─────────────────────────────────────────────────────────────────────────────
import { getElevenLabsConfig } from "./elevenlabs-config";
import type { ProviderBalance } from "./capacity";

// Rough, LABELLED conversion: ~2.6 words/sec × ~6 chars/word ≈ 936 chars/min of speech.
// Used only to give the operator an approximate "minutes remaining" — never presented as
// exact. A different model/rate would shift this; the UI marks it Estimated.
const CHARS_PER_MINUTE = 900;

interface ElevenSubscription {
  character_count?: number;
  character_limit?: number;
  next_character_count_reset_unix?: number;
}

/**
 * Fetch the ElevenLabs subscription balance. Returns null when unconfigured or on ANY
 * failure (fail-open). `fetchImpl` is injectable for tests.
 */
export async function fetchProviderBalance(
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<ProviderBalance | null> {
  const cfg = getElevenLabsConfig(opts.env ?? process.env);
  if (!cfg.apiKey) return null;
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await doFetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": cfg.apiKey, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res || !("ok" in res) || !res.ok) return null;
    const body = (await res.json()) as ElevenSubscription;
    return normalizeSubscription(body);
  } catch {
    return null; // fail-open — never let a balance probe break a page or a render
  } finally {
    clearTimeout(timer);
  }
}

/** Shape a raw subscription payload into ProviderBalance. Exported for tests. PURE. */
export function normalizeSubscription(body: ElevenSubscription | null | undefined): ProviderBalance | null {
  if (!body || typeof body !== "object") return null;
  const limit = numOrNull(body.character_limit);
  const count = numOrNull(body.character_count);
  const charactersRemaining = limit != null && count != null ? Math.max(0, limit - count) : null;
  const resetAt = body.next_character_count_reset_unix
    ? new Date(body.next_character_count_reset_unix * 1000).toISOString()
    : null;
  const minutesRemaining = charactersRemaining != null
    ? Math.round((charactersRemaining / CHARS_PER_MINUTE) * 10) / 10
    : null;
  // Nothing usable → treat as unavailable rather than a fabricated zero.
  if (charactersRemaining == null && resetAt == null) return null;
  return { charactersRemaining, charactersLimit: limit, resetAt, minutesRemaining };
}

function numOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

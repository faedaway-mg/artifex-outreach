// ─────────────────────────────────────────────────────────────────────────────
// VOICEOVER ORCHESTRATOR — narration → canonical ElevenLabs (Matt) audio → persisted
// voiceover record, integrated with the lead's canonical voice and the voiceover
// lifecycle. Idempotent, bounded-retry, fail-closed, and STRICTLY no-send: this only
// generates + persists an asset; it never authorizes or performs any outbound action.
//
// Idempotency: a READY canonical voiceover for (lead, narration revision, voice) is
// REUSED unless the caller explicitly forces a regeneration (operator action). A
// successful regeneration creates a NEW record and supersedes the prior one; the old
// asset is retained for audit. Retries happen ONLY for transient provider errors and
// are strictly bounded — never an infinite credit-burning loop.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getVoiceProvider, VoiceProviderError } from "./provider";
import { getElevenLabsConfig, elevenLabsConfigured } from "./elevenlabs-config";
import { resolveVoiceId, voiceDisplayName, voiceGeneration } from "./registry";
import {
  getLeadVoiceKey,
  canonicalVoiceover,
  createGeneratingVoiceover,
  persistVoiceoverAudio,
  markVoiceoverReady,
  markVoiceoverFailed,
  supersedeVoiceover,
  listVoiceovers,
  getVoiceConfig,
  type VoiceoverRecord,
} from "./store";
import { computeVoiceUsage, resolveVoiceUsageConfig } from "./usage";

export interface GenerateLeadVoiceoverInput {
  leadId: string;
  company?: string | null;
  offerId?: string | null;
  /** Stable narration identity (e.g. the offerId or a narration id). */
  narrationId: string;
  /** The narration revision this audio must be bound to (e.g. the narration digest). */
  narrationRevision?: string;
  /** The exact text to speak (authoritative script). */
  narrationScript: string;
  actor: string;
  /** Explicit operator regeneration — supersedes the prior canonical voiceover. */
  force?: boolean;
  now?: string;
}

export type GenerateLeadVoiceoverResult =
  | { status: "reused"; voiceover: VoiceoverRecord; voiceDisplayName: string }
  | { status: "ready"; voiceover: VoiceoverRecord; voiceDisplayName: string }
  | { status: "legacy"; reason: string; voiceKey: string; voiceDisplayName: string }
  | { status: "not_configured"; reason: string }
  | { status: "capped"; reason: string }
  | { status: "failed"; reason: string; voiceoverId: string };

// Probe real audio duration via ffprobe; on any failure fall back to a deterministic
// text-based estimate (~2.6 words/sec) so a record always has a usable duration. The
// return flags which path was used so callers/tests can distinguish.
function probeDurationSeconds(audio: Buffer, narrationScript: string): { seconds: number; measured: boolean } {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(path.join(tmpdir(), "vo-probe-"));
    const f = path.join(dir, "a.mp3");
    writeFileSync(f, audio);
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", f], { encoding: "utf8", timeout: 20_000 }).trim();
    const sec = Number(out);
    if (Number.isFinite(sec) && sec > 0) return { seconds: Math.round(sec * 100) / 100, measured: true };
  } catch {
    /* fall through to estimate */
  } finally {
    if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  const words = narrationScript.trim().split(/\s+/).filter(Boolean).length;
  return { seconds: Math.max(1, Math.round((words / 2.6) * 100) / 100), measured: false };
}

async function withBoundedRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof VoiceProviderError && e.retryable;
      if (!retryable || attempt === maxAttempts) throw e;
      // small linear backoff; deterministic, no jitter, strictly bounded
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw lastErr;
}

/**
 * Generate (or reuse) the canonical voiceover for a lead's narration. Never sends.
 * Uses the lead's canonical journey voice (Matt by default). Fully idempotent unless
 * force=true (explicit operator regeneration).
 */
export async function generateLeadVoiceover(input: GenerateLeadVoiceoverInput): Promise<GenerateLeadVoiceoverResult> {
  const now = input.now ?? new Date().toISOString();
  const revision = input.narrationRevision ?? input.narrationId;

  if (!input.narrationScript || !input.narrationScript.trim()) {
    return { status: "not_configured", reason: "Narration script is empty — nothing to generate." };
  }

  const voiceKey = await getLeadVoiceKey(input.leadId);

  // LEGACY PRESERVATION: a legacy Lucas journey is never re-generated through ElevenLabs
  // (no fake ID, no mixing). Existing Lucas assets stay valid and untouched. Converting a
  // lead to Matt is an explicit operator action (setLeadVoiceKey) — not a side effect here.
  if (voiceGeneration(voiceKey) === "legacy-lucas") {
    return {
      status: "legacy",
      reason: "Lead is a legacy Lucas journey — existing assets are preserved and no new ElevenLabs (Matt) audio is generated. Convert the journey explicitly to switch to Matt.",
      voiceKey,
      voiceDisplayName: voiceDisplayName(voiceKey),
    };
  }

  // Idempotency FIRST: reuse a current canonical READY voiceover unless explicitly forced.
  // This is checked BEFORE the configured/cap gates so an already-generated asset can be
  // reused (e.g. by a render host) without the API key present and without touching quota.
  const existing = await canonicalVoiceover(input.leadId, revision, voiceKey);
  if (existing && !input.force) {
    return { status: "reused", voiceover: existing, voiceDisplayName: voiceDisplayName(voiceKey) };
  }

  // A real new generation from here on — it needs configuration and consumes quota.
  if (!elevenLabsConfigured()) {
    return { status: "not_configured", reason: "ElevenLabs is not configured (missing API key or voice ID)." };
  }

  // OPTIONAL HARD CAP: if the operator set a hard minute cap and this billing period has
  // reached it, refuse a NEW generation (reuse above is unaffected). A deliberate spend
  // guard — distinct from the informational 75/90/100 warnings, which never block.
  const usageCfg = resolveVoiceUsageConfig(await getVoiceConfig());
  if (usageCfg.config.hardCapMinutes != null) {
    const usage = computeVoiceUsage(await listVoiceovers(), usageCfg.config, now);
    if (usage.hardCapReached) {
      return {
        status: "capped",
        reason: `Voice generation hard cap reached (${usage.minutesThisPeriod} of ${usageCfg.config.hardCapMinutes} min this period). Raise or clear the cap to generate more.`,
      };
    }
  }

  const voiceId = resolveVoiceId(voiceKey);
  if (!voiceId) {
    return { status: "not_configured", reason: `No provider voice ID resolved for voice '${voiceKey}'.` };
  }
  const cfg = getElevenLabsConfig();

  const kind: "initial" | "regeneration" = existing && input.force ? "regeneration" : "initial";

  const rec = await createGeneratingVoiceover({
    leadId: input.leadId,
    company: input.company ?? null,
    offerId: input.offerId ?? null,
    narrationId: input.narrationId,
    narrationRevision: revision,
    voiceKey,
    provider: "elevenlabs",
    voiceId,
    modelId: cfg.modelId,
    outputFormat: cfg.outputFormat,
    characterCount: input.narrationScript.length,
    kind,
    supersedes: kind === "regeneration" ? (existing?.id ?? null) : null,
    now,
    actor: input.actor,
  });

  try {
    const provider = getVoiceProvider("elevenlabs");
    const result = await withBoundedRetry(() =>
      provider.generateVoiceover({
        text: input.narrationScript,
        voiceId,
        modelId: cfg.modelId,
        outputFormat: cfg.outputFormat,
        leadId: input.leadId,
        narrationId: input.narrationId,
      }),
    );

    const stored = await persistVoiceoverAudio(rec.id, result.audio, result.contentType);
    const dur = probeDurationSeconds(result.audio, input.narrationScript);

    const ready = await markVoiceoverReady(rec.id, {
      assetKey: stored.key,
      assetBytes: stored.bytes,
      assetSha256: stored.sha256,
      durationSeconds: dur.seconds,
      durationSource: dur.measured ? "measured" : "estimated",
      requestId: result.requestId,
      now: new Date().toISOString(),
      actor: input.actor,
    });

    if (kind === "regeneration" && existing) {
      await supersedeVoiceover(existing.id, rec.id, { now: new Date().toISOString(), actor: input.actor });
    }

    return { status: "ready", voiceover: ready ?? rec, voiceDisplayName: voiceDisplayName(voiceKey) };
  } catch (e) {
    // Sanitized reason — VoiceProviderError messages are already scrubbed of secrets.
    const reason = e instanceof VoiceProviderError ? `${e.kind}: ${e.message}` : (e as Error)?.message ?? "unknown error";
    await markVoiceoverFailed(rec.id, reason, { now: new Date().toISOString(), actor: input.actor });
    return { status: "failed", reason, voiceoverId: rec.id };
  }
}

"use server";
// ─────────────────────────────────────────────────────────────────────────────
// CONTENT STUDIO — ZERO-TOUCH GENERATE (mandate §17 + capacity mandate C). ONE server
// action performs the whole pipeline the operator never sees: brief → system-written
// script → renderable 9:16 template → Matt narration (reused, never re-spent on a
// downstream failure) → bridged audio → captions → enqueued render → finished video.
// The operator presses Generate once.
//
// CAPACITY-AWARE (mandate C): before any paid Matt generation this consults the shared
// ElevenLabs Capacity Manager. A generation that would consume the protected Acquisition
// reserve does NOT silently proceed — it returns NEEDS_OVERRIDE (no spend) until the
// operator explicitly authorizes THIS single generation (override). Acquisition keeps
// priority; #202 remains the separate prospect qualification gate.
//
// COST SAFETY (§19/§22/§23): Matt TTS is generated via generateLeadVoiceover, which is
// idempotent (reuses the canonical audio when the script revision is unchanged → a render
// retry never re-spends ElevenLabs). Pre-deploy QA runs with CS_ZEROTOUCH_MOCK=1 (or with
// ElevenLabs unconfigured), which skips the paid call and renders with a deterministic
// silent placeholder so Breakbot can prove the flow without burning credits.
// ─────────────────────────────────────────────────────────────────────────────
import { revalidatePath } from "next/cache";
import { isAuthenticated, currentActor } from "@/lib/auth";
import { getPieces, addDraft, saveTemplate, writeUploadMeta } from "./store";
import { composeScriptFromBrief, scriptText, SOCIAL_VOICE_SCOPE } from "./zero-touch";
import { scriptRevisionOf, setZeroTouchState } from "./zero-touch-store";
import { planSocialAnimation } from "./zero-touch-orchestrator";
import { buildZeroTouchTemplate, zeroTouchTemplateId } from "./zero-touch-template";
import { elevenLabsConfigured } from "@/lib/voice/elevenlabs-config";
import { loadVoiceCapacity } from "@/lib/voice/capacity-store";
import { socialGeneratePolicy, forecastGeneration, type VoiceCapacity, type GenerationForecast } from "@/lib/voice/capacity";
import { buildObjectKey } from "./cs-object-key";
import { csEnvironment } from "./env-guard";
import { getArtifactStore } from "./storage-factory";
import { createHash } from "node:crypto";

export interface GenerateZeroTouchInput {
  /** Existing piece to (re)generate, or omit to create a new Field Note from title+brief. */
  pieceId?: string;
  title?: string;
  brief: string;
  /** Explicit single-generation override to spend into the protected Acquisition reserve. */
  override?: boolean;
}

export interface GenerateZeroTouchResult {
  ok: boolean;
  pieceId?: string;
  stage?: string;
  reason?: string;
  /** Set when blocked at the reserve boundary — the operator may retry with override. */
  needsOverride?: boolean;
  /** The capacity forecast for this generation (for honest UI display). */
  forecast?: GenerationForecast;
  /** Actual measured voice duration (seconds) once the Matt generation completed. */
  voiceDurationSeconds?: number | null;
  voiceStatus?: string;
}

function mockMode(): boolean {
  return process.env.CS_ZEROTOUCH_MOCK === "1" || !elevenLabsConfigured();
}

// A deterministic, valid, SILENT WAV (RIFF/WAVE, 8kHz/8-bit mono) — the no-spend QA
// placeholder audio. Real, container-valid bytes (passes detectAudioType) so the exact
// render/enqueue path runs without any ElevenLabs generation.
function silentWavBuffer(seconds = 1): Buffer {
  const sampleRate = 8000;
  const nSamples = Math.max(1, Math.floor(sampleRate * seconds));
  const dataSize = nSamples; // 8-bit mono → 1 byte/sample
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
  buf.fill(128, 44); // 8-bit PCM silence == 128
  return buf;
}

export async function generateZeroTouch(input: GenerateZeroTouchInput): Promise<GenerateZeroTouchResult> {
  if (!isAuthenticated()) return { ok: false, reason: "unauthorized" };
  const brief = (input.brief ?? "").trim();
  if (!brief) return { ok: false, reason: "add a brief to generate" };

  const actor = currentActor();
  const pieces = await getPieces();
  const piece = input.pieceId ? pieces.find((p) => p.id === input.pieceId) ?? null : null;

  // Compose the script from the brief (system writes the narration; the operator never does).
  const title = piece?.title ?? ((input.title ?? "").trim() || "Field note");
  const concept = piece?.concept ?? null;
  const targetSeconds = piece?.targetSeconds ?? 30;
  const script = composeScriptFromBrief({ brief, title, concept, targetSeconds });
  const scriptRevision = scriptRevisionOf(script);
  const spoken = scriptText(script);
  const plan = planSocialAnimation(script, targetSeconds);

  // New idea → deterministic draft id (idempotent: same brief → same piece, no dupes).
  const pieceId = piece?.id ?? `draft_zt_${scriptRevision}`;
  if (!piece) {
    await addDraft({ id: pieceId, title, concept: concept ?? "", narration: script, createdAt: new Date().toISOString() });
  }

  // ── CAPACITY GUARD (mandate C) — evaluate BEFORE any paid generation. A generation
  //    that would dip into the protected Acquisition reserve returns NEEDS_OVERRIDE
  //    (no spend) unless the operator explicitly authorized this single one.
  let capacity: VoiceCapacity | null = null;
  try {
    capacity = await loadVoiceCapacity(new Date().toISOString());
  } catch {
    capacity = null; // capacity unknown → never fabricate a limit to block on
  }
  const forecast = capacity ? forecastGeneration(capacity, plan.totalSeconds || targetSeconds) : undefined;
  if (capacity) {
    const policy = socialGeneratePolicy(capacity, plan.totalSeconds || targetSeconds, !!input.override);
    if (!policy.allowed) {
      // Persist state so the card can show the pending brief, but generate nothing.
      await setZeroTouchState({ pieceId, brief, script, scriptRevision, updatedAt: new Date().toISOString() }, actor);
      return { ok: false, pieceId, stage: "NEEDS_OVERRIDE", needsOverride: true, reason: policy.reason, forecast };
    }
  }

  // Persist the brief + script + revision (audio-reuse lineage).
  await setZeroTouchState({ pieceId, brief, script, scriptRevision, updatedAt: new Date().toISOString() }, actor);

  // Persist the RENDERABLE 9:16 template (the missing link that makes a brand-new idea
  // actually renderable by the generic worker). Idempotent by id.
  const template = buildZeroTouchTemplate({ pieceId, title, concept, script, plan });
  await saveTemplate(template);
  const renderPieceId = template.id; // sanitized id the worker/upload path use

  // 1) Matt narration — reused when unchanged, never re-spent on a downstream failure.
  //    Bridge the audio into the content-studio upload slot so the render worker muxes it.
  let voiceStatus = "mock";
  let voiceDurationSeconds: number | null = null;
  let audioKey: string | null = null;
  let audioSha: string | null = null;
  let audioName = "matt-social.mp3";
  let audioBytes = 0;

  if (!mockMode()) {
    try {
      const { generateLeadVoiceover } = await import("@/lib/voice/generate");
      const vo = await generateLeadVoiceover({
        leadId: `${SOCIAL_VOICE_SCOPE}-${renderPieceId}`,
        narrationId: renderPieceId,
        narrationRevision: scriptRevision,
        narrationScript: spoken,
        actor,
        authorization: { scope: "social" }, // Matt social scope — isolated from prospect journeys
      });
      voiceStatus = vo.status;
      if ((vo.status === "ready" || vo.status === "reused") && (vo as any).voiceover?.assetKey) {
        const rec = (vo as any).voiceover;
        audioKey = rec.assetKey;
        audioSha = rec.assetSha256 ?? null;
        voiceDurationSeconds = rec.durationSeconds ?? null;
        audioBytes = rec.assetBytes ?? 0;
        audioName = "matt-social.mp3";
      }
    } catch (e: any) {
      voiceStatus = "failed"; // fall through — a placeholder keeps the flow provable without re-spend
    }
  }

  // No real Matt audio (mock, unconfigured, or failed) → deterministic silent placeholder
  // so the render/enqueue path runs with zero ElevenLabs spend.
  if (!audioKey) {
    try {
      const buf = silentWavBuffer(Math.min(30, Math.max(2, Math.round(plan.totalSeconds || targetSeconds))));
      const key = buildObjectKey({ artifactClass: "upload", env: csEnvironment(), operatorId: "zt-placeholder", version: `${renderPieceId}_${scriptRevision}`, ext: "wav" });
      const put = await getArtifactStore().put(key, buf, { artifactClass: "upload", contentType: "audio/wav", metadata: { pieceId: renderPieceId, kind: "zero-touch-placeholder" } });
      audioKey = put.key;
      audioSha = put.sha256 ?? createHash("sha256").update(buf).digest("hex");
      audioBytes = put.bytes ?? buf.length;
      audioName = "placeholder-silent.wav";
      if (voiceStatus === "mock") voiceStatus = "mock-placeholder";
    } catch (e: any) {
      revalidatePath("/content-studio");
      return { ok: false, pieceId: renderPieceId, reason: `audio bridge failed: ${e?.message || e}`, voiceStatus, forecast };
    }
  }

  // Register the audio as the piece's canonical upload (so latestUpload → render worker muxes it).
  await writeUploadMeta({
    pieceId: renderPieceId,
    file: "",
    objectKey: audioKey,
    sha256: audioSha ?? undefined,
    name: audioName,
    bytes: audioBytes,
    durationSeconds: voiceDurationSeconds,
    uploadedAt: new Date().toISOString(),
    kind: voiceStatus.startsWith("mock") ? "placeholder" : "uploaded",
    detectedType: audioName.endsWith(".wav") ? "wav" : "mp3",
  });

  // 2) Captions from the same script (idempotent).
  try {
    const { ensureCaption } = await import("./caption-store");
    await ensureCaption({ id: renderPieceId, title, concept: concept ?? "", narration: script, businessName: null });
  } catch { /* captions are non-blocking for the generate flow */ }

  // 3) Enqueue the render (portrait 9:16). Deduped by input version → a retry reuses audio.
  let renderStatus = "queued";
  try {
    const { createRenderJob } = await import("./runner");
    const { job } = await createRenderJob(renderPieceId, { useUpload: true });
    renderStatus = job.status;
  } catch (e: any) {
    revalidatePath("/content-studio");
    return { ok: false, pieceId: renderPieceId, reason: `render enqueue failed: ${e?.message || e}`, voiceStatus, voiceDurationSeconds, forecast };
  }

  revalidatePath("/content-studio");
  return {
    ok: true,
    pieceId: renderPieceId,
    stage: renderStatus === "ready" ? "READY" : "BUILDING_VIDEO",
    voiceStatus,
    voiceDurationSeconds,
    forecast,
  };
}

/** Load the current shared voice capacity for the Content Studio card (read-only). */
export async function loadContentStudioCapacity(): Promise<VoiceCapacity | null> {
  if (!isAuthenticated()) return null;
  try {
    return await loadVoiceCapacity(new Date().toISOString());
  } catch {
    return null;
  }
}

export { zeroTouchTemplateId };

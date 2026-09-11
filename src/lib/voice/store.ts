// ─────────────────────────────────────────────────────────────────────────────
// VOICE STORE — lead-level canonical voice + voiceover records, persisted in the
// Settings JSONB singleton (namespace `voice`). No migration. Survives deploys.
//
// Two facts live here:
//   • leadVoices[leadId] = voiceKey — the canonical voice for a prospect's ENTIRE
//     journey (problem video, trust video, follow-ups all inherit it). Default =
//     artifex_default (Matt). Changing it is an explicit operator action and does NOT
//     mutate historical frozen assets.
//   • voiceovers[id] = VoiceoverRecord — every generated voiceover, bound to its exact
//     lead + narration revision + voice. Lifecycle: GENERATING → READY | FAILED.
//     Regeneration creates a NEW record and marks the prior one superseded; the old
//     asset is retained for audit (never mutated in place).
//
// Idempotency: at most ONE canonical (non-superseded) READY voiceover exists per
// (leadId, narrationRevision, voiceKey). Generated audio bytes are persisted through
// the canonical ArtifactStore (never temp filesystem as source of truth).
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes } from "node:crypto";
import { getSettings, updateSettings, appendAudit } from "../repo";
import { getArtifactStore } from "../content-studio/storage-factory";
import { buildObjectKey } from "../content-studio/cs-object-key";
import { csEnvironment } from "../content-studio/env-guard";
import { DEFAULT_VOICE_KEY, resolveJourneyVoiceKey } from "./registry";

export type VoiceoverStatus = "VOICEOVER_GENERATING" | "VOICEOVER_READY" | "VOICEOVER_FAILED";

export interface VoiceoverRecord {
  id: string;
  leadId: string;
  company: string | null;
  offerId: string | null;
  /** The narration identity + revision this audio was spoken from (the digest). */
  narrationId: string;
  narrationRevision: string;
  /** Registry voice key (e.g. artifex_default) + the resolved raw provider id (lineage). */
  voiceKey: string;
  provider: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  /** The persisted audio artifact (object-store key) + integrity. Null until READY. */
  assetKey: string | null;
  assetBytes: number | null;
  assetSha256: string | null;
  characterCount: number | null;
  durationSeconds: number | null;
  /** Whether durationSeconds was MEASURED (ffprobe) or a text ESTIMATE fallback. */
  durationSource: "measured" | "estimated" | null;
  requestId: string | null;
  status: VoiceoverStatus;
  failureReason: string | null;
  /** Whether this was the first generation for its narration, or an explicit regen. */
  kind: "initial" | "regeneration";
  createdAt: string;
  updatedAt: string;
  supersedes: string | null;
  supersededBy: string | null;
}

export interface VoiceConfig {
  /** Operator override for the ElevenLabs monthly minute allowance (null ⇒ use env/default). */
  monthlyMinuteBudget: number | null;
  /** Day-of-month (1-28) the allowance resets (null ⇒ calendar month). */
  billingResetDay: number | null;
  /** OPTIONAL operator-chosen hard cap (minutes): when set + exceeded, generation is
   *  refused (a deliberate spend guard). Distinct from the informational 75/90/100 warnings. */
  hardCapMinutes: number | null;
}

export interface VoiceState {
  leadVoices: Record<string, string>;
  voiceovers: Record<string, VoiceoverRecord>;
  config: VoiceConfig;
}

const EMPTY: VoiceState = { leadVoices: {}, voiceovers: {}, config: { monthlyMinuteBudget: null, billingResetDay: null, hardCapMinutes: null } };

async function getVoiceState(): Promise<VoiceState> {
  const s = (await getSettings()) as any;
  const v = (s.voice ?? {}) as Partial<VoiceState>;
  return {
    leadVoices: v.leadVoices ?? {},
    voiceovers: v.voiceovers ?? {},
    config: {
      monthlyMinuteBudget: v.config?.monthlyMinuteBudget ?? null,
      billingResetDay: v.config?.billingResetDay ?? null,
      hardCapMinutes: v.config?.hardCapMinutes ?? null,
    },
  };
}

async function mutateVoiceState(fn: (s: VoiceState) => void): Promise<VoiceState> {
  // Preserve SIBLING keys under `voice` that this store does not own (e.g.
  // voice.mattTrustVideos, owned by matt-trust-store). A voiceover generation must NEVER
  // clobber the recovered Matt trust videos — writing only the VoiceState projection here
  // would drop them. Merge the raw namespace with the updated projection instead.
  const rawVoice = (((await getSettings()) as any).voice ?? {}) as Record<string, unknown>;
  const s = await getVoiceState();
  fn(s);
  await updateSettings({ voice: { ...rawVoice, leadVoices: s.leadVoices, voiceovers: s.voiceovers, config: s.config } } as any);
  return s;
}

export async function readVoiceState(): Promise<VoiceState> {
  return getVoiceState();
}

// ── Lead-level canonical voice ───────────────────────────────────────────────
export async function getLeadVoiceKey(leadId: string): Promise<string> {
  const s = await getVoiceState();
  return resolveJourneyVoiceKey(s.leadVoices[leadId] ?? DEFAULT_VOICE_KEY);
}

/** Explicit operator action: set a lead's canonical journey voice. Never mutates any
 *  historical asset — only future generations inherit the change. */
export async function setLeadVoiceKey(leadId: string, requestedKey: string, actor: string): Promise<string> {
  const key = resolveJourneyVoiceKey(requestedKey);
  await mutateVoiceState((s) => {
    s.leadVoices[leadId] = key;
  });
  await appendAudit({ action: "voice.lead_voice_set", actor, targetType: "lead", targetId: leadId, meta: { voiceKey: key }, ip: null });
  return key;
}

// ── Voiceover records ────────────────────────────────────────────────────────
export async function getVoiceover(id: string): Promise<VoiceoverRecord | null> {
  return (await getVoiceState()).voiceovers[id] ?? null;
}

export async function listVoiceovers(): Promise<VoiceoverRecord[]> {
  return Object.values((await getVoiceState()).voiceovers);
}

export async function voiceoversForLead(leadId: string): Promise<VoiceoverRecord[]> {
  return (await listVoiceovers()).filter((v) => v.leadId === leadId);
}

/** The current canonical (non-superseded) READY voiceover for a narration+voice, if any. */
export async function canonicalVoiceover(leadId: string, narrationRevision: string, voiceKey: string): Promise<VoiceoverRecord | null> {
  const all = await voiceoversForLead(leadId);
  return (
    all.find(
      (v) =>
        v.narrationRevision === narrationRevision &&
        v.voiceKey === voiceKey &&
        v.status === "VOICEOVER_READY" &&
        !v.supersededBy,
    ) ?? null
  );
}

function newVoiceoverId(now: string): string {
  // Safe object-key segment: letters/digits/underscore, no dots/slashes.
  return `vo_${now.replace(/[^0-9]/g, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`;
}

export interface CreateGeneratingInput {
  leadId: string;
  company: string | null;
  offerId: string | null;
  narrationId: string;
  narrationRevision: string;
  voiceKey: string;
  provider: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  characterCount: number;
  kind: "initial" | "regeneration";
  supersedes?: string | null;
  now: string;
  actor: string;
}

export async function createGeneratingVoiceover(input: CreateGeneratingInput): Promise<VoiceoverRecord> {
  const id = newVoiceoverId(input.now);
  const rec: VoiceoverRecord = {
    id,
    leadId: input.leadId,
    company: input.company,
    offerId: input.offerId,
    narrationId: input.narrationId,
    narrationRevision: input.narrationRevision,
    voiceKey: input.voiceKey,
    provider: input.provider,
    voiceId: input.voiceId,
    modelId: input.modelId,
    outputFormat: input.outputFormat,
    assetKey: null,
    assetBytes: null,
    assetSha256: null,
    characterCount: input.characterCount,
    durationSeconds: null,
    durationSource: null,
    requestId: null,
    status: "VOICEOVER_GENERATING",
    failureReason: null,
    kind: input.kind,
    createdAt: input.now,
    updatedAt: input.now,
    supersedes: input.supersedes ?? null,
    supersededBy: null,
  };
  await mutateVoiceState((s) => {
    s.voiceovers[id] = rec;
  });
  await appendAudit({ action: "voice.voiceover_generating", actor: input.actor, targetType: "voiceover", targetId: id, meta: { leadId: input.leadId, voiceKey: input.voiceKey, kind: input.kind }, ip: null });
  return rec;
}

/** Persist the generated audio bytes through the canonical ArtifactStore. Returns the key. */
export async function persistVoiceoverAudio(id: string, audio: Buffer, contentType: string): Promise<{ key: string; sha256: string; bytes: number }> {
  const key = buildObjectKey({ artifactClass: "upload", env: csEnvironment(), operatorId: "voice-gen", version: id, ext: "mp3" });
  const store = getArtifactStore();
  const res = await store.put(key, audio, { artifactClass: "upload", contentType: contentType || "audio/mpeg", metadata: { voiceover: id, kind: "tts-voiceover" } });
  return res;
}

export interface MarkReadyInput {
  assetKey: string;
  assetBytes: number;
  assetSha256: string;
  durationSeconds: number;
  durationSource: "measured" | "estimated";
  requestId: string | null;
  now: string;
  actor: string;
}

export async function markVoiceoverReady(id: string, input: MarkReadyInput): Promise<VoiceoverRecord | null> {
  let out: VoiceoverRecord | null = null;
  await mutateVoiceState((s) => {
    const rec = s.voiceovers[id];
    if (!rec) return;
    rec.assetKey = input.assetKey;
    rec.assetBytes = input.assetBytes;
    rec.assetSha256 = input.assetSha256;
    rec.durationSeconds = input.durationSeconds;
    rec.durationSource = input.durationSource;
    rec.requestId = input.requestId;
    rec.status = "VOICEOVER_READY";
    rec.failureReason = null;
    rec.updatedAt = input.now;
    out = rec;
  });
  if (out) await appendAudit({ action: "voice.voiceover_ready", actor: input.actor, targetType: "voiceover", targetId: id, meta: { durationSeconds: input.durationSeconds, durationSource: input.durationSource, bytes: input.assetBytes }, ip: null });
  return out;
}

export async function markVoiceoverFailed(id: string, reason: string, opts: { now: string; actor: string }): Promise<VoiceoverRecord | null> {
  let out: VoiceoverRecord | null = null;
  await mutateVoiceState((s) => {
    const rec = s.voiceovers[id];
    if (!rec) return;
    rec.status = "VOICEOVER_FAILED";
    rec.failureReason = reason;
    rec.updatedAt = opts.now;
    out = rec;
  });
  if (out) await appendAudit({ action: "voice.voiceover_failed", actor: opts.actor, targetType: "voiceover", targetId: id, meta: { reason }, ip: null });
  return out;
}

/** Mark an old canonical voiceover superseded by a newer one (audit-preserving). */
export async function supersedeVoiceover(oldId: string, newId: string, opts: { now: string; actor: string }): Promise<void> {
  await mutateVoiceState((s) => {
    const oldRec = s.voiceovers[oldId];
    const newRec = s.voiceovers[newId];
    if (oldRec) {
      oldRec.supersededBy = newId;
      oldRec.updatedAt = opts.now;
    }
    if (newRec) {
      newRec.supersedes = oldId;
      newRec.updatedAt = opts.now;
    }
  });
  await appendAudit({ action: "voice.voiceover_superseded", actor: opts.actor, targetType: "voiceover", targetId: oldId, meta: { supersededBy: newId }, ip: null });
}

// ── Config (budget / billing reset) ──────────────────────────────────────────
export async function getVoiceConfig(): Promise<VoiceConfig> {
  return (await getVoiceState()).config;
}

export async function setVoiceConfig(cfg: Partial<VoiceConfig>, actor: string): Promise<VoiceConfig> {
  let out!: VoiceConfig;
  await mutateVoiceState((s) => {
    if (cfg.monthlyMinuteBudget !== undefined) s.config.monthlyMinuteBudget = cfg.monthlyMinuteBudget;
    if (cfg.billingResetDay !== undefined) s.config.billingResetDay = cfg.billingResetDay;
    if (cfg.hardCapMinutes !== undefined) s.config.hardCapMinutes = cfg.hardCapMinutes;
    out = s.config;
  });
  await appendAudit({ action: "voice.config_set", actor, targetType: "voice_config", targetId: "voice", meta: { ...out }, ip: null });
  return out;
}

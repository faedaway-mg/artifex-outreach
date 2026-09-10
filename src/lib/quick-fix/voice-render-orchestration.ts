// ─────────────────────────────────────────────────────────────────────────────
// VOICE → RENDER AUTO-ENQUEUE (master mandate §1 / #194)
//
// The prospect media pipeline must be fully automatic: once a finalist's canonical
// (Matt) voiceover is READY, a render is enqueued and picked up by the render worker
// with ZERO operator relay — no download MP3, no upload MP3, no "attach voiceover", no
// "attach render". This module is the seam that makes that automatic AND safe.
//
// It is PURE (no I/O): given the current stored personalized-video record + the READY
// voiceover + the current render inputs, it DECIDES the next record. A thin store
// wrapper (enqueuePersonalizedRender, below) applies that decision. The render worker
// then CLAIMS queued records and renders them — reusing the exact bound voiceover, so a
// render/ffmpeg failure NEVER triggers another ElevenLabs generation (§1: reuse it).
//
// Lineage is the core invariant: a QUEUED render carries the exact voiceoverId +
// voiceoverRevision + voiceGeneration it must be muxed against. assertRenderVoiceoverLineage
// proves, at render time, that the bytes about to be rendered belong to that exact
// canonical revision — a re-recorded narration cannot silently ride an old render.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type PersonalizedDiagnosticVideoRecord,
  type PersonalizedVideoStatus,
  PERSONALIZED_VIDEO_VERSION,
} from "./personalized-video";

/** The exact canonical voiceover a render must be bound to. Derived from a READY VoiceoverRecord. */
export interface VoiceoverBinding {
  voiceoverId: string;
  /** == the voiceover's narrationRevision at generation time. */
  voiceoverRevision: string;
  /** "current-matt" | "legacy-lucas" — journey coherence (never cross generations). */
  voiceGeneration: string;
}

/** Everything that identifies the render to enqueue — derived from the offer + storyboard, NOT re-fetched. */
export interface RenderEnqueueInputs {
  offerId: string;
  offerVersion: string;
  leadId: string;
  company: string;
  website: string | null;
  evidenceVersion: string; // == evidence digest
  narrationVersion: string;
  narrationDigest: string;
  renderVersion: string;
  idempotencyKey: string;
  /** False when the storyboard has no evidence-backed finding to walk through. */
  buildable: boolean;
  blockedReason: string | null;
}

export type RenderEnqueueAction =
  | "enqueue" // fresh QUEUED render bound to this voiceover
  | "noop-in-flight" // already QUEUED/RENDERING for these exact inputs
  | "noop-ready" // already READY, bound to this exact voiceover revision + current inputs
  | "blocked"; // storyboard not buildable → nothing honest to render

export interface RenderEnqueueDecision {
  action: RenderEnqueueAction;
  /** The record to persist (for "enqueue" and "blocked"); null for no-op actions. */
  nextRecord: PersonalizedDiagnosticVideoRecord | null;
  reason: string;
}

/**
 * Build the fresh QUEUED record for a render, bound to the canonical voiceover. The
 * render worker will fill in the durable keys / URLs / duration when it renders. Pure.
 */
export function buildQueuedRenderRecord(
  inputs: RenderEnqueueInputs,
  binding: VoiceoverBinding,
  now: string,
): PersonalizedDiagnosticVideoRecord {
  return {
    offerId: inputs.offerId,
    offerVersion: inputs.offerVersion,
    leadId: inputs.leadId,
    company: inputs.company,
    website: inputs.website,
    evidenceVersion: inputs.evidenceVersion,
    narrationVersion: inputs.narrationVersion,
    renderVersion: inputs.renderVersion,
    personalizedVideoVersion: PERSONALIZED_VIDEO_VERSION,
    status: "QUEUED",
    // LINEAGE — the render MUST mux against exactly this voiceover revision/generation.
    voiceoverId: binding.voiceoverId,
    voiceoverRevision: binding.voiceoverRevision,
    voiceGeneration: binding.voiceGeneration,
    sourceEvidenceDigest: inputs.evidenceVersion,
    narrationDigest: inputs.narrationDigest,
    renderedAssetDigest: null,
    mp4Key: null,
    posterKey: null,
    captionsKey: null,
    mp4Url: null,
    posterUrl: null,
    captionsUrl: null,
    durationSeconds: null,
    captionVersion: null,
    captionsVerified: false,
    idempotencyKey: inputs.idempotencyKey,
    queuedAt: now,
    generatedAt: null,
    verifiedAt: null,
    failureReason: null,
  };
}

/** Whether the two records describe the SAME render inputs (a re-enqueue would be a no-op). */
function sameRenderInputs(
  record: PersonalizedDiagnosticVideoRecord,
  inputs: RenderEnqueueInputs,
): boolean {
  return (
    record.offerVersion === inputs.offerVersion &&
    record.evidenceVersion === inputs.evidenceVersion &&
    record.narrationVersion === inputs.narrationVersion &&
    record.renderVersion === inputs.renderVersion &&
    record.idempotencyKey === inputs.idempotencyKey
  );
}

/** Whether an existing record is already bound to this exact canonical voiceover revision. */
function boundToVoiceover(
  record: PersonalizedDiagnosticVideoRecord,
  binding: VoiceoverBinding,
): boolean {
  return (
    record.voiceoverId === binding.voiceoverId &&
    record.voiceoverRevision === binding.voiceoverRevision &&
    record.voiceGeneration === binding.voiceGeneration
  );
}

/**
 * Decide what to do when a canonical voiceover becomes READY for an offer. Idempotent
 * and monotone:
 *   • not buildable  → BLOCKED (never enqueue a video with no honest finding)
 *   • already READY for these exact inputs + bound to this voiceover → NO-OP (§1/§12: reuse)
 *   • already QUEUED/RENDERING for these exact inputs + same voiceover → NO-OP (in flight)
 *   • otherwise (fresh / stale / failed / re-recorded / different voiceover) → ENQUEUE
 *
 * The "different voiceover revision" case DOES re-enqueue: a re-recorded narration must
 * re-render. But this only changes the RENDER binding — it does NOT itself spend
 * ElevenLabs; the voiceover was already generated (or reused) by the caller upstream.
 */
export function planRenderEnqueue(
  existing: PersonalizedDiagnosticVideoRecord | null | undefined,
  inputs: RenderEnqueueInputs,
  binding: VoiceoverBinding,
  now: string,
): RenderEnqueueDecision {
  if (!inputs.buildable) {
    return {
      action: "blocked",
      nextRecord: {
        ...buildQueuedRenderRecord(inputs, binding, now),
        status: "FAILED" as PersonalizedVideoStatus,
        failureReason: inputs.blockedReason ?? "storyboard not buildable",
      },
      reason: inputs.blockedReason ?? "storyboard not buildable",
    };
  }

  if (existing && sameRenderInputs(existing, inputs) && boundToVoiceover(existing, binding)) {
    if (existing.status === "READY") {
      return { action: "noop-ready", nextRecord: null, reason: "already READY for these inputs + voiceover — reuse, no re-render" };
    }
    if (existing.status === "QUEUED" || existing.status === "RENDERING") {
      return { action: "noop-in-flight", nextRecord: null, reason: `render already ${existing.status} for these inputs + voiceover` };
    }
  }

  return {
    action: "enqueue",
    nextRecord: buildQueuedRenderRecord(inputs, binding, now),
    reason: existing ? "inputs or voiceover changed — enqueue fresh render" : "no prior render — enqueue",
  };
}

// ── Lineage assertion (consumed by the render worker, §1) ────────────────────
export class RenderLineageError extends Error {
  code: "VOICEOVER_MISMATCH" | "MISSING_BINDING" | "GENERATION_MISMATCH";
  constructor(code: RenderLineageError["code"], message: string) {
    super(message);
    this.name = "RenderLineageError";
    this.code = code;
  }
}

/**
 * Prove — at render time, before muxing — that the audio about to be used is the EXACT
 * canonical voiceover the QUEUED record was bound to. Throws (fail-closed) on any
 * mismatch so a stale/wrong-generation audio can never be silently rendered into a
 * prospect's journey. Pure.
 */
export function assertRenderVoiceoverLineage(
  record: PersonalizedDiagnosticVideoRecord,
  voiceover: { id: string; narrationRevision: string; generation: string | null },
): void {
  if (!record.voiceoverId || !record.voiceoverRevision) {
    throw new RenderLineageError("MISSING_BINDING", "render record has no bound voiceover — refusing to render unbound audio");
  }
  if (record.voiceoverId !== voiceover.id || record.voiceoverRevision !== voiceover.narrationRevision) {
    throw new RenderLineageError(
      "VOICEOVER_MISMATCH",
      `render bound to voiceover ${record.voiceoverId}@${record.voiceoverRevision} but got ${voiceover.id}@${voiceover.narrationRevision}`,
    );
  }
  if (voiceover.generation && record.voiceGeneration && record.voiceGeneration !== voiceover.generation) {
    throw new RenderLineageError(
      "GENERATION_MISMATCH",
      `render bound to ${record.voiceGeneration} but voiceover is ${voiceover.generation} — never cross generations`,
    );
  }
}

// ── Worker claim (pure) ──────────────────────────────────────────────────────
/** The statuses a render worker may pick up and (re)render. QUEUED = fresh; FAILED = retry (reuses voiceover). */
const CLAIMABLE: ReadonlySet<PersonalizedVideoStatus> = new Set<PersonalizedVideoStatus>(["QUEUED", "FAILED"]);

export interface RenderClaim {
  offerId: string;
  record: PersonalizedDiagnosticVideoRecord;
  /** True when this claim is a retry of a previously FAILED render (voiceover MUST be reused). */
  isRetry: boolean;
}

/**
 * From a set of offers' personalized-video records, select the ones a render worker
 * should process now: QUEUED (never started) and FAILED (retry). RENDERING is skipped
 * (in flight); READY/STALE/BLOCKED/NOT_GENERATED are not the worker's job here. A FAILED
 * claim is a retry — the worker reuses the already-bound voiceover and does NOT re-spend
 * ElevenLabs. Pure; deterministic order by offerId. Records without a bound voiceover are
 * NOT claimable (nothing to reuse) — they must be re-enqueued through planRenderEnqueue.
 */
export function claimQueuedRenders(
  records: Array<{ offerId: string; record: PersonalizedDiagnosticVideoRecord | null | undefined }>,
): RenderClaim[] {
  const out: RenderClaim[] = [];
  for (const { offerId, record } of records) {
    if (!record) continue;
    if (!CLAIMABLE.has(record.status)) continue;
    if (!record.voiceoverId || !record.voiceoverRevision) continue; // unbound → not a reuse-safe claim
    out.push({ offerId, record, isRetry: record.status === "FAILED" });
  }
  return out.sort((a, b) => (a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0));
}

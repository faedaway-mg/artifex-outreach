// ─────────────────────────────────────────────────────────────────────────────
// SPRINT AUDIO UPLOAD — pure validation + binding + render-gating decisions (mandate 28). The route performs
// the IO (store bytes, create job); THIS module decides: is the file a valid Voice Memo, does it dedup a
// retry, does it bind to the exact revision, and may it queue rendering. Never show "Uploaded" unless the
// persisted artifact + revision binding are confirmed — the route asserts that with these results.
// ─────────────────────────────────────────────────────────────────────────────
import { verifyTranscript, type TranscriptResult } from "./transcript";

// Voice Memos formats (mandate 28): M4A / AAC / MP3 / WAV. Validate by MIME AND file signature (magic bytes).
export const ALLOWED_AUDIO_MIME = ["audio/mp4", "audio/x-m4a", "audio/aac", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"];
export const MAX_AUDIO_BYTES = 60 * 1024 * 1024; // 60 MB
export const MIN_AUDIO_SECONDS = 5;
export const MAX_AUDIO_SECONDS = 600;

export type UploadReasonCode =
  | "OK" | "BAD_MIME" | "BAD_SIGNATURE" | "TOO_LARGE" | "TOO_SHORT" | "TOO_LONG"
  | "IDEMPOTENT_DUPLICATE" | "REVISION_MISMATCH" | "TRANSCRIPT_BLOCKED";

export interface AudioMeta { mime: string; bytes: number; durationSeconds: number; signatureOk: boolean }

export interface AudioValidation { ok: boolean; code: UploadReasonCode; reason: string }
/** Validate MIME + signature + size + duration. Signature (magic bytes) is checked by the caller and passed in. */
export function validateAudio(m: AudioMeta): AudioValidation {
  if (!ALLOWED_AUDIO_MIME.includes(m.mime)) return { ok: false, code: "BAD_MIME", reason: `unsupported type ${m.mime}` };
  if (!m.signatureOk) return { ok: false, code: "BAD_SIGNATURE", reason: "file signature does not match an audio container" };
  if (m.bytes > MAX_AUDIO_BYTES) return { ok: false, code: "TOO_LARGE", reason: `file exceeds ${MAX_AUDIO_BYTES} bytes` };
  if (m.durationSeconds < MIN_AUDIO_SECONDS) return { ok: false, code: "TOO_SHORT", reason: `recording under ${MIN_AUDIO_SECONDS}s` };
  if (m.durationSeconds > MAX_AUDIO_SECONDS) return { ok: false, code: "TOO_LONG", reason: `recording over ${MAX_AUDIO_SECONDS}s` };
  return { ok: true, code: "OK", reason: "valid audio" };
}

export interface UploadPlanInput {
  meta: AudioMeta;
  sha256: string;
  scriptRevisionId: string;
  inputVersion: string;
  requestedRevisionId: string;        // the revision the client believes it's recording for
  existingArtifactSha?: string | null; // prior audio bound to THIS input version (for dedup)
  narration: string;
  spokenTranscript: string;
  transcriptAvailable?: boolean;
}

export interface UploadPlan {
  ok: boolean;
  code: UploadReasonCode;
  reason: string;
  idempotent: boolean;                // a duplicate retry of the identical bytes → converge, don't re-store
  bindsToRevision: string;
  inputVersion: string;
  transcript: TranscriptResult | null;
  shouldQueueRender: boolean;         // ONLY when validated + revision-bound + transcript auto-renderable
}

/** Decide the full upload outcome. Deterministic. The route stores bytes + creates AT MOST one render job
 *  according to `shouldQueueRender`, and returns "Uploaded" only after persistence is confirmed. */
export function planUpload(i: UploadPlanInput): UploadPlan {
  const base = { bindsToRevision: i.scriptRevisionId, inputVersion: i.inputVersion, transcript: null as TranscriptResult | null };
  // Bind to the EXACT current revision the operator is recording for — a stale client revision is refused.
  if (i.requestedRevisionId && i.requestedRevisionId !== i.scriptRevisionId) {
    return { ok: false, code: "REVISION_MISMATCH", reason: "the script revision changed — re-open the current script", idempotent: false, shouldQueueRender: false, ...base };
  }
  const v = validateAudio(i.meta);
  if (!v.ok) return { ok: false, code: v.code, reason: v.reason, idempotent: false, shouldQueueRender: false, ...base };

  // Idempotency: identical bytes already bound to this input version → converge to one artifact + one job.
  if (i.existingArtifactSha && i.existingArtifactSha === i.sha256) {
    return { ok: true, code: "IDEMPOTENT_DUPLICATE", reason: "identical audio already uploaded", idempotent: true, shouldQueueRender: false, ...base };
  }

  const transcript = verifyTranscript(i.narration, i.spokenTranscript, { available: i.transcriptAvailable });
  const shouldQueueRender = transcript.canAutoRender;
  return {
    ok: true,
    code: shouldQueueRender ? "OK" : "TRANSCRIPT_BLOCKED",
    reason: shouldQueueRender ? "audio uploaded — rendering queued" : `audio uploaded — ${transcript.reason}`,
    idempotent: false, bindsToRevision: i.scriptRevisionId, inputVersion: i.inputVersion,
    transcript, shouldQueueRender,
  };
}

/** A late render for an OLDER input version can never become canonical (mandate 28 §5). */
export function isStaleRender(renderInputVersion: string, currentInputVersion: string): boolean {
  return renderInputVersion !== currentInputVersion;
}

// Content Studio — PostgreSQL-backed LIFECYCLE store (jobs, uploads, approvals, posted markers, shares).
// This is the durable metadata layer that replaces the .data/*.json files in staging/production, so:
//   • web ENQUEUE and worker CLAIM operate on the SAME content_studio_jobs rows (no filesystem hand-off),
//   • uploads/approvals/posted/shares survive web + worker restarts and never need writable container disk.
// Artifact BYTES stay in content_studio_artifacts (cs-storage-pg.ts); these tables carry only metadata +
// object keys. store.ts / share.ts delegate here when CS_STORAGE_PROVIDER=postgres; local/test keep files.
import postgres from "postgres";
import type { RenderJob, AudioUpload, Approval, AudioKind } from "./types";
import type { ContentTemplate } from "./template-schema";
import type { DraftPiece } from "./store";

let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (_sql) return _sql;
  const url = process.env.CS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("cs-lifecycle-pg: CS_DATABASE_URL/DATABASE_URL not set");
  const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
  _sql = postgres(url, { max: 4, prepare: false, ssl });
  return _sql;
}
export async function __closeLifecyclePgForTests() { if (_sql) { await _sql.end(); _sql = null; } }

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const isoOrNull = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

// ── Jobs (shared web↔worker records) ─────────────────────────────────────────
function rowToJob(r: Record<string, unknown>): RenderJob {
  return {
    id: String(r.id),
    pieceId: String(r.piece_id),
    inputVersion: String(r.input_version),
    status: r.status as RenderJob["status"],
    progress: Number(r.progress ?? 0),
    stage: String(r.stage ?? ""),
    mode: r.mode as RenderJob["mode"],
    audioKind: (r.audio_kind as AudioKind) ?? "uploaded",
    audioFile: null, // dev-only path — never persisted
    audioKey: (r.audio_key as string) ?? null,
    audioSha: (r.audio_sha as string) ?? null,
    audioLabel: (r.audio_label as string) ?? null,
    outputFile: null, // dev-only path — never persisted
    outputRel: (r.output_rel as string) ?? null,
    outputKey: (r.output_key as string) ?? null,
    posterKey: (r.poster_key as string) ?? null,
    thumbRel: (r.thumb_rel as string) ?? null,
    error: (r.error as string) ?? null,
    attempt: Number(r.attempt ?? 0),
    pid: null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    startedAt: isoOrNull(r.started_at),
    finishedAt: isoOrNull(r.finished_at),
  };
}

// Create-or-update a job. On INSERT (enqueue) every field is set. ON CONFLICT we update only the
// WEB-owned display fields — status/worker_id/lease_until/attempt/output_key/poster_key/finished_at are
// owned by the worker (claimOne/publishSuccess in worker-loop.mjs) and are never clobbered by a web write.
export async function writeJobPg(job: RenderJob): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO content_studio_jobs
      (id, piece_id, input_version, status, progress, stage, mode, audio_kind, audio_key, audio_sha,
       audio_label, output_key, poster_key, output_rel, thumb_rel, error, attempt,
       created_at, updated_at, started_at, finished_at)
    VALUES
      (${job.id}, ${job.pieceId}, ${job.inputVersion}, ${job.status}, ${job.progress}, ${job.stage},
       ${job.mode}, ${job.audioKind}, ${job.audioKey}, ${job.audioSha}, ${job.audioLabel},
       ${job.outputKey}, ${job.posterKey}, ${job.outputRel}, ${job.thumbRel}, ${job.error}, ${job.attempt},
       ${job.createdAt}, ${job.updatedAt}, ${job.startedAt}, ${job.finishedAt})
    ON CONFLICT (id) DO UPDATE SET
      stage = EXCLUDED.stage, progress = EXCLUDED.progress, error = EXCLUDED.error,
      thumb_rel = EXCLUDED.thumb_rel, output_rel = EXCLUDED.output_rel, updated_at = now()`;
}
export async function readJobPg(id: string): Promise<RenderJob | null> {
  const rows = await db()`SELECT * FROM content_studio_jobs WHERE id = ${id}`;
  return rows.length ? rowToJob(rows[0]) : null;
}
export async function listJobsPg(): Promise<RenderJob[]> {
  const rows = await db()`SELECT * FROM content_studio_jobs ORDER BY created_at`;
  return rows.map(rowToJob);
}

// ── Posted markers ───────────────────────────────────────────────────────────
export async function readPostedPg(): Promise<Record<string, string>> {
  const rows = await db()`SELECT piece_id, posted_at FROM content_studio_posted`;
  const out: Record<string, string> = {};
  for (const r of rows) out[String(r.piece_id)] = iso(r.posted_at);
  return out;
}
export async function setPostedPg(pieceId: string, when: string): Promise<void> {
  await db()`INSERT INTO content_studio_posted (piece_id, posted_at) VALUES (${pieceId}, ${when})
    ON CONFLICT (piece_id) DO UPDATE SET posted_at = EXCLUDED.posted_at`;
}

// ── Approvals (one per piece, version-bound) ─────────────────────────────────
export async function readApprovalsPg(): Promise<Record<string, Approval>> {
  const rows = await db()`SELECT * FROM content_studio_approvals`;
  const out: Record<string, Approval> = {};
  for (const r of rows) out[String(r.piece_id)] = {
    pieceId: String(r.piece_id), jobId: String(r.job_id), inputVersion: String(r.input_version),
    outputRel: (r.output_rel as string) ?? "", audioSig: String(r.audio_sig), approvedAt: iso(r.approved_at),
  };
  return out;
}
export async function setApprovalPg(a: Approval): Promise<void> {
  await db()`INSERT INTO content_studio_approvals (piece_id, job_id, input_version, output_rel, audio_sig, approved_at)
    VALUES (${a.pieceId}, ${a.jobId}, ${a.inputVersion}, ${a.outputRel}, ${a.audioSig}, ${a.approvedAt})
    ON CONFLICT (piece_id) DO UPDATE SET job_id = EXCLUDED.job_id, input_version = EXCLUDED.input_version,
      output_rel = EXCLUDED.output_rel, audio_sig = EXCLUDED.audio_sig, approved_at = EXCLUDED.approved_at`;
}
export async function clearApprovalPg(pieceId: string): Promise<void> {
  await db()`DELETE FROM content_studio_approvals WHERE piece_id = ${pieceId}`;
}

// ── Uploads (metadata; bytes live in content_studio_artifacts) ───────────────
function rowToUpload(r: Record<string, unknown>): AudioUpload {
  return {
    pieceId: String(r.piece_id), file: "", objectKey: (r.object_key as string) ?? undefined,
    sha256: (r.sha256 as string) ?? undefined, name: String(r.name), bytes: Number(r.byte_size),
    durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
    uploadedAt: iso(r.uploaded_at), kind: (r.kind as AudioUpload["kind"]) ?? "uploaded",
  };
}
export async function writeUploadPg(meta: AudioUpload): Promise<void> {
  const id = meta.objectKey || `${meta.pieceId}:${meta.uploadedAt}`; // object key is unique per upload
  await db()`INSERT INTO content_studio_uploads (id, piece_id, object_key, name, byte_size, sha256, duration_seconds, kind, uploaded_at)
    VALUES (${id}, ${meta.pieceId}, ${meta.objectKey ?? ""}, ${meta.name}, ${meta.bytes}, ${meta.sha256 ?? ""},
            ${meta.durationSeconds}, ${meta.kind}, ${meta.uploadedAt})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, byte_size = EXCLUDED.byte_size,
      sha256 = EXCLUDED.sha256, duration_seconds = EXCLUDED.duration_seconds, kind = EXCLUDED.kind`;
}
export async function listUploadsPg(pieceId: string): Promise<AudioUpload[]> {
  const rows = await db()`SELECT * FROM content_studio_uploads WHERE piece_id = ${pieceId} ORDER BY uploaded_at DESC`;
  return rows.map(rowToUpload);
}

// ── Templates (operator-authored; committed templates stay read-only seeds, not stored here) ──
export async function saveTemplatePg(t: ContentTemplate): Promise<void> {
  const businessId = (t as { businessId?: string | null }).businessId ?? null;
  await db()`INSERT INTO content_studio_templates (id, doc, business_id, updated_at)
    VALUES (${t.id}, ${db().json(t as unknown as Record<string, never>)}, ${businessId}, now())
    ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, business_id = EXCLUDED.business_id, updated_at = now()`;
}
export async function loadTemplatePg(id: string): Promise<ContentTemplate | null> {
  const rows = await db()`SELECT doc FROM content_studio_templates WHERE id = ${id}`;
  return rows.length ? (rows[0].doc as ContentTemplate) : null;
}
export async function listTemplateIdsPg(): Promise<string[]> {
  const rows = await db()`SELECT id FROM content_studio_templates`;
  return rows.map((r) => String(r.id));
}
export async function hasTemplatePg(id: string): Promise<boolean> {
  const rows = await db()`SELECT 1 FROM content_studio_templates WHERE id = ${id}`;
  return rows.length > 0;
}

// ── Drafts (operator-created concepts) ────────────────────────────────────────
export async function readDraftsPg(): Promise<DraftPiece[]> {
  const rows = await db()`SELECT id, title, concept, narration, created_at FROM content_studio_drafts ORDER BY created_at`;
  return rows.map((r) => ({
    id: String(r.id), title: String(r.title), concept: (r.concept as string) ?? "",
    narration: Array.isArray(r.narration) ? (r.narration as string[]) : [], createdAt: iso(r.created_at),
  }));
}
export async function addDraftPg(d: DraftPiece): Promise<void> {
  await db()`INSERT INTO content_studio_drafts (id, title, concept, narration, created_at)
    VALUES (${d.id}, ${d.title}, ${d.concept}, ${db().json(d.narration as unknown as Record<string, never>)}, ${d.createdAt})
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, concept = EXCLUDED.concept, narration = EXCLUDED.narration`;
}

// ── Captions (one persisted social caption per piece, with revision history) ──
import type { CaptionRecord } from "./caption-store";
function rowToCaption(r: Record<string, unknown>): CaptionRecord {
  return {
    pieceId: String(r.piece_id), text: String(r.text),
    source: (r.source as CaptionRecord["source"]) ?? "generated", edited: Boolean(r.edited),
    revisions: Array.isArray(r.revisions) ? (r.revisions as CaptionRecord["revisions"]) : [],
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}
export async function readCaptionPg(pieceId: string): Promise<CaptionRecord | null> {
  const rows = await db()`SELECT * FROM content_studio_captions WHERE piece_id = ${pieceId}`;
  return rows.length ? rowToCaption(rows[0]) : null;
}
export async function readCaptionsPg(): Promise<Record<string, CaptionRecord>> {
  const rows = await db()`SELECT * FROM content_studio_captions`;
  const out: Record<string, CaptionRecord> = {};
  for (const r of rows) out[String(r.piece_id)] = rowToCaption(r);
  return out;
}
export async function upsertCaptionPg(rec: CaptionRecord): Promise<void> {
  await db()`INSERT INTO content_studio_captions (piece_id, text, source, edited, revisions, created_at, updated_at)
    VALUES (${rec.pieceId}, ${rec.text}, ${rec.source}, ${rec.edited},
            ${db().json(rec.revisions as unknown as Record<string, never>)}, ${rec.createdAt}, ${rec.updatedAt})
    ON CONFLICT (piece_id) DO UPDATE SET text = EXCLUDED.text, source = EXCLUDED.source,
      edited = EXCLUDED.edited, revisions = EXCLUDED.revisions, updated_at = EXCLUDED.updated_at`;
}

// ── Shares (record persistence; frozen bytes live in content_studio_artifacts) ─
import type { ShareRecord } from "./share";
function rowToShare(r: Record<string, unknown>): ShareRecord {
  return {
    token: String(r.token), pieceId: String(r.piece_id),
    businessId: (r.business_id as string) ?? null, businessName: (r.business_name as string) ?? null,
    title: String(r.title), intro: (r.intro as string) ?? "",
    videoHash: String(r.video_hash), inputVersion: String(r.input_version),
    videoKey: String(r.video_key), posterKey: (r.poster_key as string) ?? null,
    posterContentType: (r.poster_content_type as string) ?? "image/jpeg",
    posterRel: (r.poster_rel as string) ?? "", emailThumbRel: (r.email_thumb_rel as string) ?? null,
    createdAt: iso(r.created_at), revokedAt: isoOrNull(r.revoked_at),
  };
}
export async function insertSharePg(s: ShareRecord): Promise<void> {
  await db()`INSERT INTO content_studio_shares
    (token, piece_id, business_id, business_name, title, intro, video_key, poster_key, video_hash,
     input_version, poster_content_type, poster_rel, email_thumb_rel, created_at, revoked_at)
    VALUES (${s.token}, ${s.pieceId}, ${s.businessId}, ${s.businessName}, ${s.title}, ${s.intro},
     ${s.videoKey}, ${s.posterKey}, ${s.videoHash}, ${s.inputVersion}, ${s.posterContentType},
     ${s.posterRel}, ${s.emailThumbRel}, ${s.createdAt}, ${s.revokedAt})`;
}
export async function getSharePg(token: string): Promise<ShareRecord | null> {
  const rows = await db()`SELECT * FROM content_studio_shares WHERE token = ${token}`;
  return rows.length ? rowToShare(rows[0]) : null;
}
export async function revokeSharePg(token: string): Promise<boolean> {
  const rows = await db()`UPDATE content_studio_shares SET revoked_at = now() WHERE token = ${token} AND revoked_at IS NULL RETURNING token`;
  return rows.length > 0;
}
export async function sharesForPiecePg(pieceId: string): Promise<ShareRecord[]> {
  const rows = await db()`SELECT * FROM content_studio_shares WHERE piece_id = ${pieceId} ORDER BY created_at DESC`;
  return rows.map(rowToShare);
}

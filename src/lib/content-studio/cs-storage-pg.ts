// Content Studio — PostgreSQL-native artifact backend (durable bytes in bytea; the $0 production storage,
// no R2). Publication is ATOMIC (one INSERT — a partial write is never visible). SHA-256 is stored and
// verifiable. Range reads use substring(data ...) so Postgres extracts the slice SERVER-SIDE — the web
// process never buffers a whole video per Range request. Ownership-fenced worker writes. Soft delete +
// expiry make revoked/abandoned artifacts unavailable without destroying accounting.

import postgres from "postgres";
import { createHash } from "node:crypto";

export type ArtifactClass = "upload" | "input" | "output" | "poster" | "share-media";

let _sql: ReturnType<typeof postgres> | null = null;
function db() {
  if (_sql) return _sql;
  const url = process.env.CS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("cs-storage-pg: DATABASE_URL not set");
  const ssl = url.includes("proxy.rlwy.net") || url.includes("railway") ? { rejectUnauthorized: false } : undefined;
  _sql = postgres(url, { max: 4, prepare: false, ssl });
  return _sql;
}
export function csPgConfigured(): boolean {
  return Boolean(process.env.CS_DATABASE_URL || process.env.DATABASE_URL);
}
export async function __closePgForTests() { if (_sql) { await _sql.end(); _sql = null; } }

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const liveClause = (sql: ReturnType<typeof postgres>) => sql`deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;

// Atomic, idempotent publish (ON CONFLICT). The full bytes + published_at land in ONE statement.
// Ownership fence: when jobId is given, an existing row owned by a DIFFERENT job is not overwritten.
export async function putArtifactPg(key: string, body: Buffer, contentType: string, opts: { artifactClass: ArtifactClass; jobId?: string | null; shareToken?: string | null; expiresAt?: Date | null; metadata?: Record<string, unknown> } ): Promise<{ key: string; sha256: string; bytes: number }> {
  const sql = db();
  const hash = sha256(body);
  const rows = await sql`
    INSERT INTO content_studio_artifacts (object_key, content_type, byte_size, sha256, data, artifact_class, job_id, share_token, metadata, published_at, expires_at)
    VALUES (${key}, ${contentType}, ${body.length}, ${hash}, ${body}, ${opts.artifactClass}, ${opts.jobId ?? null}, ${opts.shareToken ?? null}, ${sql.json(opts.metadata ?? {})}, now(), ${opts.expiresAt ?? null})
    ON CONFLICT (object_key) DO UPDATE
      SET content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256,
          data = EXCLUDED.data, published_at = now(), expires_at = EXCLUDED.expires_at, deleted_at = NULL
      WHERE content_studio_artifacts.job_id IS NOT DISTINCT FROM EXCLUDED.job_id
         OR content_studio_artifacts.job_id IS NULL
    RETURNING object_key`;
  if (rows.length === 0) throw new Error(`ownership-fenced: ${key} is owned by another job`);
  return { key, sha256: hash, bytes: body.length };
}

export interface ArtifactMeta { key: string; size: number; contentType: string; sha256: string; artifactClass: string; jobId: string | null; shareToken: string | null; }

// Metadata only (for HEAD / Range headers / ETag) — never loads the bytes. Null when missing/deleted/expired.
export async function getArtifactMetaPg(key: string): Promise<ArtifactMeta | null> {
  const sql = db();
  const rows = await sql`SELECT object_key, byte_size, content_type, sha256, artifact_class, job_id, share_token
    FROM content_studio_artifacts WHERE object_key = ${key} AND ${liveClause(sql)}`;
  if (!rows.length) return null;
  const r = rows[0];
  return { key: r.object_key, size: Number(r.byte_size), contentType: r.content_type, sha256: r.sha256, artifactClass: r.artifact_class, jobId: r.job_id, shareToken: r.share_token };
}
export const artifactExistsPg = async (key: string) => (await getArtifactMetaPg(key)) != null;

// Server-side byte-range slice (1-indexed substring). Returns exactly [start,end] inclusive. Bounded —
// only the requested bytes leave Postgres.
export async function readArtifactRangePg(key: string, start: number, end: number): Promise<Buffer | null> {
  const sql = db();
  const len = end - start + 1;
  if (len <= 0) return Buffer.alloc(0);
  const rows = await sql`SELECT substring(data from ${start + 1} for ${len}) AS chunk
    FROM content_studio_artifacts WHERE object_key = ${key} AND ${liveClause(sql)}`;
  if (!rows.length) return null;
  return Buffer.from(rows[0].chunk);
}
export async function readArtifactFullPg(key: string): Promise<Buffer | null> {
  const sql = db();
  const rows = await sql`SELECT data FROM content_studio_artifacts WHERE object_key = ${key} AND ${liveClause(sql)}`;
  if (!rows.length) return null;
  return Buffer.from(rows[0].data);
}

// Soft delete (unavailable immediately; accounting preserved for audit). Revoke/expiry use this.
export async function deleteArtifactPg(key: string): Promise<void> {
  const sql = db();
  await sql`UPDATE content_studio_artifacts SET deleted_at = now() WHERE object_key = ${key}`;
}
export async function expireArtifactsPg(now = new Date()): Promise<number> {
  const sql = db();
  const rows = await sql`UPDATE content_studio_artifacts SET deleted_at = now()
    WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ${now} RETURNING object_key`;
  return rows.length;
}

export interface StorageUsage { artifactCount: number; usedBytes: number; oldestExpirable: string | null; }
export async function storageUsagePg(): Promise<StorageUsage> {
  const sql = db();
  const rows = await sql`SELECT * FROM content_studio_storage_usage`;
  const r = rows[0] ?? {};
  return { artifactCount: Number(r.artifact_count ?? 0), usedBytes: Number(r.used_bytes ?? 0), oldestExpirable: r.oldest_expirable ?? null };
}

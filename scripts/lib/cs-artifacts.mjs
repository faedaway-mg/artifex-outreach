// Content Studio — Node-side PostgreSQL artifact store for the render WORKER (which is plain .mjs and
// can't import the TS ArtifactStore). Mirrors src/lib/content-studio/cs-storage-pg.ts exactly against the
// SAME content_studio_artifacts table, so web (TS) and worker (Node) exchange only object keys and read
// identical bytes. Atomic publish (one INSERT), SHA-256, ownership fence, server-side Range slice.
import postgres from "postgres";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { existsSync, mkdirSync, createReadStream } from "node:fs";
import path from "node:path";

// Backend selection mirrors src/lib/content-studio/storage-factory.ts EXACTLY so the Node worker and the
// TS web agree in BOTH dev (durable-local files) and staging/production (Postgres) — same keys, same bytes.
function mode() {
  const p = (process.env.CS_STORAGE_PROVIDER ?? "").trim().toLowerCase();
  if (p === "postgres" || p === "pg") return "postgres";
  if (p === "local") return "local";
  if (process.env.NODE_ENV === "production") throw new Error("cs-artifacts FAIL-CLOSED: production requires CS_STORAGE_PROVIDER=postgres");
  return "local";
}
function localRoot() {
  return process.env.CONTENT_STUDIO_DATA_DIR
    ? path.join(path.resolve(process.env.CONTENT_STUDIO_DATA_DIR), "artifacts")
    : path.join(process.cwd(), ".data", "content-studio", "artifacts");
}
const localPath = (key) => path.join(localRoot(), key.replace(/^content-studio\//, ""));
const metaPath = (key) => localPath(key) + ".meta.json";

let _sql = null;
function db() {
  if (_sql) return _sql;
  const url = process.env.CS_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("cs-artifacts: CS_DATABASE_URL/DATABASE_URL not set");
  const ssl = /proxy\.rlwy\.net|railway/.test(url) ? { rejectUnauthorized: false } : undefined;
  _sql = postgres(url, { max: 4, prepare: false, ssl });
  return _sql;
}
export async function closeArtifacts() { if (_sql) { await _sql.end(); _sql = null; } }
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// Canonical, safe, version-bound object key (mirrors src/lib/content-studio/cs-object-key.ts).
const SAFE = /^[a-z0-9][a-z0-9_-]{0,63}$/i, EXT = /^[a-z0-9]{1,8}$/i;
const ENVS = new Set(["development", "test", "staging", "production"]);
export function buildObjectKey({ artifactClass, env, version, ext, operatorId, jobId, shareToken }) {
  env = (env || "").toLowerCase();
  if (!ENVS.has(env)) throw new Error("cs-artifacts: unknown env " + env);
  ext = String(ext).replace(/^\./, "").toLowerCase();
  if (!EXT.test(ext)) throw new Error("cs-artifacts: unsafe ext " + ext);
  const seg = (n, v) => { if (!v || !SAFE.test(v)) throw new Error(`cs-artifacts: unsafe ${n} ${JSON.stringify(v)}`); return v; };
  const ver = seg("version", version);
  if (artifactClass === "upload") return `content-studio/${env}/upload/${seg("operatorId", operatorId || "op")}/${ver}.${ext}`;
  if (artifactClass === "render-input" || artifactClass === "render-output" || artifactClass === "poster")
    return `content-studio/${env}/${artifactClass}/${seg("jobId", jobId || "")}/${ver}.${ext}`;
  if (artifactClass === "share-media") return `content-studio/${env}/share-media/${seg("shareToken", shareToken || "")}/${ver}.${ext}`;
  throw new Error("cs-artifacts: unknown class " + artifactClass);
}

// Atomic + idempotent publish; ownership-fenced (a different job can't overwrite).
export async function putArtifact(key, body, contentType, { artifactClass, jobId = null, shareToken = null, expiresAt = null, metadata = {} }) {
  const hashLocal = sha256(body);
  if (mode() === "local") {
    const p = localPath(key); mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`; await fs.writeFile(tmp, body); await fs.rename(tmp, p); // atomic
    await fs.writeFile(metaPath(key), JSON.stringify({ key, size: body.length, contentType, sha256: hashLocal, artifactClass, jobId, shareToken }));
    return { key, sha256: hashLocal, bytes: body.length };
  }
  const sql = db();
  const hash = sha256(body);
  const rows = await sql`
    INSERT INTO content_studio_artifacts (object_key, content_type, byte_size, sha256, data, artifact_class, job_id, share_token, metadata, published_at, expires_at)
    VALUES (${key}, ${contentType}, ${body.length}, ${hash}, ${body}, ${artifactClass}, ${jobId}, ${shareToken}, ${sql.json(metadata)}, now(), ${expiresAt})
    ON CONFLICT (object_key) DO UPDATE
      SET content_type=EXCLUDED.content_type, byte_size=EXCLUDED.byte_size, sha256=EXCLUDED.sha256,
          data=EXCLUDED.data, published_at=now(), expires_at=EXCLUDED.expires_at, deleted_at=NULL
      WHERE content_studio_artifacts.job_id IS NOT DISTINCT FROM EXCLUDED.job_id OR content_studio_artifacts.job_id IS NULL
    RETURNING object_key`;
  if (!rows.length) throw new Error(`cs-artifacts: ownership-fenced — ${key} owned by another job`);
  return { key, sha256: hash, bytes: body.length };
}

const LIVE = (sql) => sql`deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now())`;
export async function getArtifactMeta(key) {
  if (mode() === "local") { try { return JSON.parse(await fs.readFile(metaPath(key), "utf8")); } catch { return null; } }
  const sql = db();
  const r = await sql`SELECT object_key, byte_size, content_type, sha256, artifact_class, job_id, share_token
    FROM content_studio_artifacts WHERE object_key=${key} AND ${LIVE(sql)}`;
  if (!r.length) return null;
  const x = r[0];
  return { key: x.object_key, size: Number(x.byte_size), contentType: x.content_type, sha256: x.sha256, artifactClass: x.artifact_class, jobId: x.job_id, shareToken: x.share_token };
}
export async function readArtifactRange(key, start, end) {
  const len = end - start + 1; if (len <= 0) return Buffer.alloc(0);
  if (mode() === "local") {
    const p = localPath(key); if (!existsSync(p)) return null;
    return new Promise((res, rej) => { const c = []; createReadStream(p, { start, end }).on("data", (x) => c.push(Buffer.from(x))).on("end", () => res(Buffer.concat(c))).on("error", rej); });
  }
  const sql = db();
  const r = await sql`SELECT substring(data from ${start + 1} for ${len}) AS chunk FROM content_studio_artifacts WHERE object_key=${key} AND ${LIVE(sql)}`;
  return r.length ? Buffer.from(r[0].chunk) : null;
}
export async function readArtifactFull(key) {
  if (mode() === "local") { const p = localPath(key); return existsSync(p) ? fs.readFile(p) : null; }
  const sql = db();
  const r = await sql`SELECT data FROM content_studio_artifacts WHERE object_key=${key} AND ${LIVE(sql)}`;
  return r.length ? Buffer.from(r[0].data) : null;
}
export async function deleteArtifact(key) {
  if (mode() === "local") { for (const f of [localPath(key), metaPath(key)]) if (existsSync(f)) await fs.rm(f, { force: true }); return; }
  await db()`UPDATE content_studio_artifacts SET deleted_at=now() WHERE object_key=${key}`;
}

// Materialize a stored artifact to a LOCAL file (for tools that need a real path, e.g. ffmpeg). Reads the
// bytes by key, VERIFIES existence + integrity (an optional expected sha AND the store's own meta sha),
// then writes a unique file under destDir. Throws on missing / deleted / expired / tampered input. The
// CALLER owns cleanup of destDir (and must never persist the returned path). Returns { path, sha, bytes }.
export async function materializeArtifact(key, { destDir, filename, expectedSha = null }) {
  const meta = await getArtifactMeta(key);
  if (!meta) throw new Error("artifact unavailable (missing / expired / deleted): " + key);
  const bytes = await readArtifactFull(key);
  if (!bytes) throw new Error("artifact unreadable: " + key);
  const hash = sha256(bytes);
  if (expectedSha && hash !== expectedSha) throw new Error("integrity check failed (sha ≠ expected): " + key);
  if (meta.sha256 && hash !== meta.sha256) throw new Error("integrity check failed (sha ≠ stored meta): " + key);
  mkdirSync(destDir, { recursive: true });
  const p = path.join(destDir, filename);
  await fs.writeFile(p, bytes);
  return { path: p, sha: hash, bytes: bytes.length };
}

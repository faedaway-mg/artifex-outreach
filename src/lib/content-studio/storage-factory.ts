// Content Studio — the ONE authoritative artifact-storage factory. Web and worker resolve their store
// ONLY through here, so they always agree and no route instantiates an adapter itself. Production/staging
// MUST select PostgreSQL explicitly and FAIL CLOSED on any misconfiguration — production can never
// silently fall back to local disk. Object keys are the only cross-process artifact reference.

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync, createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as pg from "./cs-storage-pg";
import type { ArtifactClass } from "./cs-storage-pg";

export type StorageMode = "local" | "postgres";

export interface ArtifactMeta { key: string; size: number; contentType: string; sha256: string; artifactClass: string; jobId: string | null; shareToken: string | null; }
export interface PutOpts { artifactClass: ArtifactClass; contentType: string; jobId?: string | null; shareToken?: string | null; expiresAt?: Date | null; metadata?: Record<string, unknown>; }

// The unified store both backends implement. Range is a first-class op so callers never buffer a whole
// video for a partial request.
export interface ArtifactStore {
  mode: StorageMode;
  put(key: string, body: Buffer, opts: PutOpts): Promise<{ key: string; sha256: string; bytes: number }>;
  getMeta(key: string): Promise<ArtifactMeta | null>;
  readRange(key: string, start: number, end: number): Promise<Buffer | null>;
  readFull(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  del(key: string): Promise<void>;
}

// ── Fail-closed configuration ────────────────────────────────────────────────
export function resolveStorageMode(env: NodeJS.ProcessEnv = process.env): StorageMode {
  const isProd = env.NODE_ENV === "production";
  const provider = (env.CS_STORAGE_PROVIDER ?? "").trim().toLowerCase();

  if (provider === "postgres" || provider === "pg") {
    if (!env.CS_DATABASE_URL && !env.DATABASE_URL) {
      throw new Error("Content Studio storage FAIL-CLOSED: CS_STORAGE_PROVIDER=postgres but neither CS_DATABASE_URL nor DATABASE_URL is set.");
    }
    return "postgres";
  }
  if (provider === "local") {
    if (isProd) throw new Error("Content Studio storage FAIL-CLOSED: local storage is prohibited in production (set CS_STORAGE_PROVIDER=postgres).");
    return "local";
  }
  if (provider === "") {
    // No explicit provider: dev/test default to local; PRODUCTION refuses (no silent local fallback).
    if (isProd) throw new Error("Content Studio storage FAIL-CLOSED: production requires CS_STORAGE_PROVIDER=postgres — refusing to fall back to local disk.");
    return "local";
  }
  throw new Error(`Content Studio storage FAIL-CLOSED: unknown CS_STORAGE_PROVIDER '${provider}'.`);
}

// ── PostgreSQL-backed store ──────────────────────────────────────────────────
const pgStore: ArtifactStore = {
  mode: "postgres",
  put: (key, body, o) => pg.putArtifactPg(key, body, o.contentType, o),
  getMeta: (key) => pg.getArtifactMetaPg(key),
  readRange: (key, s, e) => pg.readArtifactRangePg(key, s, e),
  readFull: (key) => pg.readArtifactFullPg(key),
  exists: (key) => pg.artifactExistsPg(key),
  del: (key) => pg.deleteArtifactPg(key),
};

// ── Durable-local store (dev/test only) ──────────────────────────────────────
// Resolved dynamically (not captured at import) so dev/test can point it at an isolated dir.
function localRoot() {
  return process.env.CONTENT_STUDIO_DATA_DIR
    ? path.join(path.resolve(process.env.CONTENT_STUDIO_DATA_DIR), "artifacts")
    : path.join(process.cwd(), ".data", "content-studio", "artifacts");
}
const localPath = (key: string) => path.join(localRoot(), key.replace(/^content-studio\//, ""));
const metaPath = (key: string) => localPath(key) + ".meta.json";

const localStore: ArtifactStore = {
  mode: "local",
  async put(key, body, o) {
    const p = localPath(key);
    mkdirSync(path.dirname(p), { recursive: true });
    const sha = createHash("sha256").update(body).digest("hex");
    const tmp = `${p}.tmp-${process.pid}`;
    await fs.writeFile(tmp, body); await fs.rename(tmp, p); // atomic
    await fs.writeFile(metaPath(key), JSON.stringify({ key, size: body.length, contentType: o.contentType, sha256: sha, artifactClass: o.artifactClass, jobId: o.jobId ?? null, shareToken: o.shareToken ?? null }));
    return { key, sha256: sha, bytes: body.length };
  },
  async getMeta(key) { try { return JSON.parse(await fs.readFile(metaPath(key), "utf8")); } catch { return null; } },
  async readRange(key, start, end) {
    const p = localPath(key);
    if (!existsSync(p)) return null;
    return new Promise((res, rej) => { const chunks: Buffer[] = []; createReadStream(p, { start, end }).on("data", (c) => chunks.push(Buffer.from(c))).on("end", () => res(Buffer.concat(chunks))).on("error", rej); });
  },
  async readFull(key) { const p = localPath(key); return existsSync(p) ? fs.readFile(p) : null; },
  async exists(key) { return existsSync(localPath(key)); },
  async del(key) { for (const f of [localPath(key), metaPath(key)]) if (existsSync(f)) await fs.rm(f, { force: true }); },
};

// ── Accessor (with test injection) ───────────────────────────────────────────
let _injected: ArtifactStore | null = null;
export function __setArtifactStoreForTests(s: ArtifactStore | null) { _injected = s; }
export function getArtifactStore(env: NodeJS.ProcessEnv = process.env): ArtifactStore {
  if (_injected) return _injected;
  return resolveStorageMode(env) === "postgres" ? pgStore : localStore;
}

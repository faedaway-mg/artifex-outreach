// ─────────────────────────────────────────────────────────────────────────────
// Persisted social-caption store for Content Studio pieces (Field Notes + client videos). One current
// caption per piece plus an append-only revision history. Postgres-backed in staging/production
// (content_studio_captions); an in-memory map backs local/test. Owner edits are protected: a
// Regenerate over an owner-edited caption requires an explicit force (the API asks to confirm first).
// ─────────────────────────────────────────────────────────────────────────────
import * as pg from "./cs-lifecycle-pg";
import { generateCaption, type CaptionSource } from "./caption-generator";

export interface CaptionRevision { text: string; source: "generated" | "edited"; at: string; }
export interface CaptionRecord {
  pieceId: string;
  text: string;
  source: "generated" | "edited";
  edited: boolean;              // true once the OWNER has edited — guards against silent regen overwrite
  revisions: CaptionRevision[]; // prior versions, newest last (current text is NOT duplicated here)
  createdAt: string;
  updatedAt: string;
}

const pgMode = () => (process.env.CS_STORAGE_PROVIDER ?? "").trim().toLowerCase() === "postgres";
const mem = new Map<string, CaptionRecord>();
/** Test seam — reset the in-memory caption store. */
export function __resetCaptionsForTests() { mem.clear(); }

const now = () => new Date().toISOString();

export async function getCaption(pieceId: string): Promise<CaptionRecord | null> {
  if (pgMode()) return pg.readCaptionPg(pieceId);
  return mem.get(pieceId) ?? null;
}
export async function readCaptions(): Promise<Record<string, CaptionRecord>> {
  if (pgMode()) return pg.readCaptionsPg();
  return Object.fromEntries(mem.entries());
}
async function put(rec: CaptionRecord): Promise<void> {
  if (pgMode()) return pg.upsertCaptionPg(rec);
  mem.set(rec.pieceId, rec);
}

/** Push the current caption into the revision log (newest last), capped to the last 50. */
function withRevision(prev: CaptionRecord | null): CaptionRevision[] {
  if (!prev) return [];
  const next = [...prev.revisions, { text: prev.text, source: prev.source, at: prev.updatedAt }];
  return next.slice(-50);
}

/** Save an OWNER-EDITED caption (marks edited=true; preserves the prior version in history). */
export async function saveCaption(pieceId: string, text: string): Promise<CaptionRecord> {
  const prev = await getCaption(pieceId);
  const rec: CaptionRecord = {
    pieceId, text, source: "edited", edited: true,
    revisions: withRevision(prev), createdAt: prev?.createdAt ?? now(), updatedAt: now(),
  };
  await put(rec);
  return rec;
}

export interface RegenerateResult { needsConfirm?: true; caption?: CaptionRecord; }

/**
 * Regenerate the caption from the piece's approved script. If the current caption was OWNER-EDITED and
 * `force` is not set, returns { needsConfirm:true } WITHOUT changing anything (the UI confirms first).
 * On (re)generation the prior caption is preserved in history and edited resets to false.
 */
export async function regenerateCaption(src: CaptionSource, opts: { force?: boolean } = {}): Promise<RegenerateResult> {
  const prev = await getCaption(src.id);
  if (prev?.edited && !opts.force) return { needsConfirm: true };
  const text = generateCaption(src);
  const rec: CaptionRecord = {
    pieceId: src.id, text, source: "generated", edited: false,
    revisions: withRevision(prev), createdAt: prev?.createdAt ?? now(), updatedAt: now(),
  };
  await put(rec);
  return { caption: rec };
}

/** Ensure a piece has a caption, generating+saving one if absent. Idempotent (never overwrites). Used
 *  by the posting-ready flow and the backfill so a posting-ready/posted piece always has a caption. */
export async function ensureCaption(src: CaptionSource): Promise<CaptionRecord> {
  const existing = await getCaption(src.id);
  if (existing) return existing;
  const text = generateCaption(src);
  const rec: CaptionRecord = { pieceId: src.id, text, source: "generated", edited: false, revisions: [], createdAt: now(), updatedAt: now() };
  await put(rec);
  return rec;
}

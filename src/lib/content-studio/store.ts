// Content Studio — persistent store (server-only). Jobs, posted markers and upload metadata live on
// disk under .data/content-studio/ so they SURVIVE A BROWSER REFRESH and a dev-server restart without
// touching the shared Postgres migrations (which several worktrees are actively churning). Each job is
// its own file (jobs/<id>.json) so the API poller and the detached render worker never race on one
// file. PRODUCTION NOTE: mirror this into a `field_note_jobs` table + S3 (see review_video_jobs) when
// deploying — the shapes are intentionally 1:1 with that schema.

import { promises as fs } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { AudioUpload, Piece, RenderJob } from "./types";
import { CATALOG, baseCatalogPiece, recommendedCandidates } from "./catalog";
import { jobsForPiece, latestReadyJob } from "./job";

export const REPO_ROOT = process.cwd();
export const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const DATA_DIR = path.join(REPO_ROOT, ".data", "content-studio");
const JOBS_DIR = path.join(DATA_DIR, "jobs");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const POSTED_FILE = path.join(DATA_DIR, "posted.json");
const DRAFTS_FILE = path.join(DATA_DIR, "drafts.json");

function ensureDirs() {
  for (const d of [DATA_DIR, JOBS_DIR, UPLOADS_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function jobsDir() { ensureDirs(); return JOBS_DIR; }
export function uploadsDirFor(pieceId: string) {
  ensureDirs();
  const d = path.join(UPLOADS_DIR, pieceId.replace(/[^0-9a-z_-]/gi, "_"));
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

// Convert an absolute path under /public into the URL Next serves it at (or null if not public).
export function publicRel(abs: string | null): string | null {
  if (!abs) return null;
  const rel = path.relative(PUBLIC_DIR, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return "/" + rel.split(path.sep).join("/");
}

async function writeAtomic(file: string, data: string) {
  ensureDirs();
  const tmp = file + ".tmp-" + process.pid;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
export async function writeJob(job: RenderJob): Promise<void> {
  await writeAtomic(path.join(jobsDir(), `${job.id}.json`), JSON.stringify(job, null, 2));
}
export async function readJob(id: string): Promise<RenderJob | null> {
  try {
    const raw = await fs.readFile(path.join(jobsDir(), `${id}.json`), "utf8");
    return JSON.parse(raw) as RenderJob;
  } catch {
    return null;
  }
}
export async function listJobs(): Promise<RenderJob[]> {
  ensureDirs();
  const files = (await fs.readdir(JOBS_DIR)).filter((f) => f.endsWith(".json") && !f.includes(".tmp-"));
  const out: RenderJob[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(JOBS_DIR, f), "utf8")) as RenderJob);
    } catch { /* skip corrupt/partial */ }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ── Posted markers ───────────────────────────────────────────────────────────
export async function readPosted(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(POSTED_FILE, "utf8"));
  } catch {
    return {};
  }
}
export async function setPosted(pieceId: string, when: string): Promise<void> {
  const cur = await readPosted();
  cur[pieceId] = when;
  await writeAtomic(POSTED_FILE, JSON.stringify(cur, null, 2));
}

// ── Uploads ──────────────────────────────────────────────────────────────────
export async function listUploads(pieceId: string): Promise<AudioUpload[]> {
  const dir = uploadsDirFor(pieceId);
  try {
    const metas = (await fs.readdir(dir)).filter((f) => f.endsWith(".meta.json"));
    const out: AudioUpload[] = [];
    for (const m of metas) out.push(JSON.parse(await fs.readFile(path.join(dir, m), "utf8")));
    return out.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  } catch {
    return [];
  }
}
export async function writeUploadMeta(meta: AudioUpload): Promise<void> {
  await writeAtomic(meta.file + ".meta.json", JSON.stringify(meta, null, 2));
}
export async function latestUpload(pieceId: string): Promise<AudioUpload | null> {
  const ups = await listUploads(pieceId);
  return ups[0] ?? null;
}

// ── Draft pieces (operator-created new concepts) ─────────────────────────────
export interface DraftPiece { id: string; title: string; concept: string; narration: string[]; createdAt: string; }
export async function readDrafts(): Promise<DraftPiece[]> {
  try { return JSON.parse(await fs.readFile(DRAFTS_FILE, "utf8")); } catch { return []; }
}
export async function addDraft(d: DraftPiece): Promise<void> {
  const cur = await readDrafts();
  cur.push(d);
  await writeAtomic(DRAFTS_FILE, JSON.stringify(cur, null, 2));
}
function draftToPiece(d: DraftPiece): Piece {
  return {
    id: d.id, title: d.title, concept: d.concept, narration: d.narration,
    captionIG: null, captionLI: null, sceneBasename: null, renderable: false,
    targetSeconds: null, thumbRel: "", recommendedRel: null, hasThumbnailFirst: false,
  };
}

// ── Piece resolution (catalog + disk + jobs) ─────────────────────────────────
function firstExisting(candidates: string[]): string | null {
  for (const rel of candidates) {
    const abs = path.join(PUBLIC_DIR, "content", rel);
    if (existsSync(abs)) return "/content/" + rel;
  }
  return null;
}

export async function getPieces(): Promise<Piece[]> {
  const jobs = await listJobs();
  const posted = await readPosted();
  const drafts = await readDrafts();
  const catalogPieces = CATALOG.map((entry) => {
    const base = baseCatalogPiece(entry);
    const ready = latestReadyJob(jobs, entry.id);
    let recommendedRel: string | null = null;
    let hasThumbnailFirst = false;
    if (ready?.outputRel) {
      recommendedRel = ready.outputRel; // freshly rendered → always thumbnail-first
      hasThumbnailFirst = true;
    } else {
      recommendedRel = firstExisting(recommendedCandidates(entry.id));
      hasThumbnailFirst = Boolean(recommendedRel && recommendedRel.includes("-final-vo-thumb"));
    }
    return { ...base, recommendedRel, hasThumbnailFirst } as Piece;
  });
  return [...catalogPieces, ...drafts.map(draftToPiece)];
}

export async function studioSnapshot() {
  const [pieces, jobs, posted] = await Promise.all([getPieces(), listJobs(), readPosted()]);
  const byPiece = await Promise.all(
    pieces.map(async (p) => ({
      piece: p,
      jobs: jobsForPiece(jobs, p.id),
      uploads: await listUploads(p.id),
      postedAt: posted[p.id] ?? null,
    })),
  );
  return byPiece;
}

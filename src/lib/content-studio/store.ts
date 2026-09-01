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
import type { ContentTemplate } from "./template-schema";
import * as pg from "./cs-lifecycle-pg";

// Storage mode: in staging/production the lifecycle records (jobs, uploads, approvals, posted) are durable
// in Postgres so web enqueue + worker claim share the SAME rows; dev/test keep the file store below.
function pgMode(): boolean {
  const p = (process.env.CS_STORAGE_PROVIDER ?? "").trim().toLowerCase();
  return p === "postgres" || p === "pg";
}

export const REPO_ROOT = process.cwd();
export const PUBLIC_DIR = path.join(REPO_ROOT, "public");
// Data dir is overridable so tests (and an isolated persistent store) don't touch the app's real state.
const DATA_DIR = process.env.CONTENT_STUDIO_DATA_DIR
  ? path.resolve(process.env.CONTENT_STUDIO_DATA_DIR)
  : path.join(REPO_ROOT, ".data", "content-studio");
const JOBS_DIR = path.join(DATA_DIR, "jobs");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const POSTED_FILE = path.join(DATA_DIR, "posted.json");
const APPROVALS_FILE = path.join(DATA_DIR, "approvals.json");
const DRAFTS_FILE = path.join(DATA_DIR, "drafts.json");
const TEMPLATES_DATA = path.join(DATA_DIR, "templates"); // UI-created (private)
const TEMPLATES_PUBLIC = path.join(PUBLIC_DIR, "content", "templates"); // committed (e.g. #007)

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

let writeSeq = 0;
async function writeAtomic(file: string, data: string) {
  ensureDirs();
  // Unique temp name per call (pid + monotonic counter) so concurrent writes to the same target — a
  // separate worker and the poll reconcile, or two in-process writes — never collide on rename.
  const tmp = `${file}.tmp-${process.pid}-${writeSeq++}`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
export async function writeJob(job: RenderJob): Promise<void> {
  if (pgMode()) return pg.writeJobPg(job);
  await writeAtomic(path.join(jobsDir(), `${job.id}.json`), JSON.stringify(job, null, 2));
}
export async function readJob(id: string): Promise<RenderJob | null> {
  if (pgMode()) return pg.readJobPg(id);
  try {
    const raw = await fs.readFile(path.join(jobsDir(), `${id}.json`), "utf8");
    return JSON.parse(raw) as RenderJob;
  } catch {
    return null;
  }
}
export async function listJobs(): Promise<RenderJob[]> {
  if (pgMode()) return pg.listJobsPg();
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
  if (pgMode()) return pg.readPostedPg();
  try {
    return JSON.parse(await fs.readFile(POSTED_FILE, "utf8"));
  } catch {
    return {};
  }
}
export async function setPosted(pieceId: string, when: string): Promise<void> {
  if (pgMode()) return pg.setPostedPg(pieceId, when);
  const cur = await readPosted();
  cur[pieceId] = when;
  await writeAtomic(POSTED_FILE, JSON.stringify(cur, null, 2));
}

// ── Approvals (explicit operator action, version-bound) ──────────────────────
export async function readApprovals(): Promise<Record<string, import("./types").Approval>> {
  if (pgMode()) return pg.readApprovalsPg();
  try { return JSON.parse(await fs.readFile(APPROVALS_FILE, "utf8")); } catch { return {}; }
}
export async function setApproval(a: import("./types").Approval): Promise<void> {
  if (pgMode()) return pg.setApprovalPg(a);
  const cur = await readApprovals();
  cur[a.pieceId] = a;
  await writeAtomic(APPROVALS_FILE, JSON.stringify(cur, null, 2));
}
export async function clearApproval(pieceId: string): Promise<void> {
  if (pgMode()) return pg.clearApprovalPg(pieceId);
  const cur = await readApprovals();
  delete cur[pieceId];
  await writeAtomic(APPROVALS_FILE, JSON.stringify(cur, null, 2));
}

// ── Uploads ──────────────────────────────────────────────────────────────────
export async function listUploads(pieceId: string): Promise<AudioUpload[]> {
  if (pgMode()) return pg.listUploadsPg(pieceId);
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
  if (pgMode()) return pg.writeUploadPg(meta);
  await writeAtomic(meta.file + ".meta.json", JSON.stringify(meta, null, 2));
}
export async function latestUpload(pieceId: string): Promise<AudioUpload | null> {
  const ups = await listUploads(pieceId);
  return ups[0] ?? null;
}

// ── Templates (data-driven pieces, e.g. #007) ────────────────────────────────
export function templatePath(id: string): string | null {
  const safe = id.replace(/[^0-9a-z_-]/gi, "_");
  for (const dir of [TEMPLATES_DATA, TEMPLATES_PUBLIC]) {
    const p = path.join(dir, `${safe}.json`);
    if (existsSync(p)) return p;
  }
  return null;
}
// The committed (read-only SEED) template shipped in the image — never written, never copied into PG.
function publicTemplatePath(id: string): string | null {
  const p = path.join(TEMPLATES_PUBLIC, `${id.replace(/[^0-9a-z_-]/gi, "_")}.json`);
  return existsSync(p) ? p : null;
}
async function loadPublicTemplate(id: string): Promise<ContentTemplate | null> {
  const p = publicTemplatePath(id);
  if (!p) return null;
  try { return JSON.parse(await fs.readFile(p, "utf8")) as ContentTemplate; } catch { return null; }
}
export async function loadTemplate(id: string): Promise<ContentTemplate | null> {
  // pg mode: an AUTHORED template (PG) overrides a same-id committed seed; else fall back to the seed.
  if (pgMode()) return (await pg.loadTemplatePg(id)) ?? loadPublicTemplate(id);
  const p = templatePath(id);
  if (!p) return null;
  try { return JSON.parse(await fs.readFile(p, "utf8")) as ContentTemplate; } catch { return null; }
}
export async function saveTemplate(t: ContentTemplate): Promise<string> {
  if (pgMode()) { await pg.saveTemplatePg(t); return t.id; }
  ensureDirs();
  if (!existsSync(TEMPLATES_DATA)) mkdirSync(TEMPLATES_DATA, { recursive: true });
  const file = path.join(TEMPLATES_DATA, `${t.id}.json`);
  await writeAtomic(file, JSON.stringify(t, null, 2));
  return file;
}
export async function listTemplateIds(): Promise<string[]> {
  const ids = new Set<string>();
  // Committed seeds are always available (read-only, from the image).
  if (existsSync(TEMPLATES_PUBLIC)) for (const f of require("node:fs").readdirSync(TEMPLATES_PUBLIC)) if (f.endsWith(".json")) ids.add(f.replace(/\.json$/, ""));
  if (pgMode()) { for (const id of await pg.listTemplateIdsPg()) ids.add(id); }
  else if (existsSync(TEMPLATES_DATA)) for (const f of require("node:fs").readdirSync(TEMPLATES_DATA)) if (f.endsWith(".json")) ids.add(f.replace(/\.json$/, ""));
  return [...ids];
}
export async function hasTemplate(id: string): Promise<boolean> {
  if (pgMode()) return (await pg.hasTemplatePg(id)) || publicTemplatePath(id) != null;
  return templatePath(id) != null;
}

// ── Draft pieces (operator-created new concepts) ─────────────────────────────
export interface DraftPiece { id: string; title: string; concept: string; narration: string[]; createdAt: string; }
export async function readDrafts(): Promise<DraftPiece[]> {
  if (pgMode()) return pg.readDraftsPg();
  try { return JSON.parse(await fs.readFile(DRAFTS_FILE, "utf8")); } catch { return []; }
}
export async function addDraft(d: DraftPiece): Promise<void> {
  if (pgMode()) return pg.addDraftPg(d);
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
    if (ready?.outputKey) {
      recommendedRel = `/api/content-studio/media/${entry.id}`; // served from the store by key (prod-safe)
      hasThumbnailFirst = true;
    } else if (ready?.outputRel) {
      recommendedRel = ready.outputRel; // dev fallback (local /content path) — freshly rendered, thumbnail-first
      hasThumbnailFirst = true;
    } else {
      recommendedRel = firstExisting(recommendedCandidates(entry.id));
      hasThumbnailFirst = Boolean(recommendedRel && recommendedRel.includes("-final-vo-thumb"));
    }
    return { ...base, recommendedRel, hasThumbnailFirst } as Piece;
  });
  // Template (data-driven) pieces — rendered by the generic engine, so they are renderable.
  const templateIds = (await listTemplateIds()).filter((id) => !CATALOG.some((c) => c.id === id));
  const templatePieces: Piece[] = [];
  for (const id of templateIds) {
    const t = await loadTemplate(id);
    if (!t) continue;
    const ready = latestReadyJob(jobs, id);
    let recommendedRel: string | null = null;
    let hasThumbnailFirst = false;
    if (ready?.outputKey) { recommendedRel = `/api/content-studio/media/${id}`; hasThumbnailFirst = true; }
    else if (ready?.outputRel) { recommendedRel = ready.outputRel; hasThumbnailFirst = true; }
    else { recommendedRel = firstExisting(recommendedCandidates(id)); hasThumbnailFirst = Boolean(recommendedRel); }
    templatePieces.push({
      id, title: t.title, concept: t.concept, narration: t.narration,
      captionIG: t.captions?.ig ?? null, captionLI: t.captions?.li ?? null,
      sceneBasename: "scene-template.html", renderable: true, targetSeconds: null,
      thumbRel: `/content/thumbnails/field-note-${id}-thumbnail.png`, recommendedRel, hasThumbnailFirst,
    });
  }
  return [...catalogPieces, ...templatePieces, ...drafts.map(draftToPiece)];
}

export async function studioSnapshot() {
  const { readCaptions } = await import("./caption-store");
  const [pieces, jobs, posted, approvals, captions] = await Promise.all([getPieces(), listJobs(), readPosted(), readApprovals(), readCaptions()]);
  const byPiece = await Promise.all(
    pieces.map(async (p) => {
      const pieceJobs = jobsForPiece(jobs, p.id);
      const ready = latestReadyJob(jobs, p.id);
      const approval = approvals[p.id] ?? null;
      // Provenance of the CURRENT recommended output. A disk-resolved recommended for #001–#006 is an
      // approved master (its audio is the previously-approved final); a template render carries the
      // job's explicit audioKind; otherwise unknown.
      const isApprovedMasterPiece = ["001", "002", "003", "004", "005", "006"].includes(p.id);
      const audioKind: import("./types").AudioKind | null = ready
        ? ready.audioKind
        : p.recommendedRel && isApprovedMasterPiece ? "approved-master" : null;
      const approved = Boolean(
        (ready && approval && approval.jobId === ready.id && approval.inputVersion === ready.inputVersion) ||
        (!ready && p.recommendedRel && isApprovedMasterPiece), // prior approved master
      );
      const approvalStale = Boolean(approval && ready && approval.inputVersion !== ready.inputVersion);
      const postingAllowed = audioKind !== "placeholder" && (approved || audioKind === "approved-master");
      return {
        piece: p,
        jobs: pieceJobs,
        uploads: await listUploads(p.id),
        postedAt: posted[p.id] ?? null,
        caption: captions[p.id] ?? null,
        provenance: { audioKind, approved, approvalStale, postingAllowed },
      };
    }),
  );
  return byPiece;
}

// Content Studio — render runner (server-only). Turns a "generate" request into a REAL background job:
// creates the durable job record, then spawns the detached Field Notes render worker
// (scripts/content-studio-render.mjs → headless Chrome + ffmpeg). The worker is independent of the HTTP
// request, so the render survives a browser refresh; the UI polls the job file for progress. Repeated
// clicks are de-duplicated by (pieceId + inputVersion).

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { RenderJob } from "./types";
import { inputVersion, findActiveDuplicate } from "./job";
import { catalogEntry, isRenderable } from "./catalog";
import { listJobs, writeJob, latestUpload, REPO_ROOT, hasTemplate, loadTemplate } from "./store";
import { audioSignature } from "./upload";

export const TEMPLATE_VERSION = "fieldnote-thumbfirst-v2-datadriven";

function fnv(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return "s" + (h >>> 0).toString(16).padStart(8, "0");
}

async function scriptVersion(pieceId: string): Promise<string> {
  const tpl = await loadTemplate(pieceId);
  if (tpl) return fnv(`${pieceId}|template|${JSON.stringify(tpl.beats)}|${tpl.narration.join("¶")}`);
  const e = catalogEntry(pieceId);
  return fnv(`${pieceId}|${e?.sceneBasename ?? ""}|${(e?.narration ?? []).join("¶")}`);
}

export interface CreateResult {
  job: RenderJob;
  deduped: boolean;
}

// Create (or reuse) a render job for a piece. `useUpload` picks the most recent uploaded VO; otherwise
// the approved audio stream is reused byte-for-byte (only valid for #004–#006).
export async function createRenderJob(pieceId: string, opts: { useUpload: boolean }): Promise<CreateResult> {
  const isTemplate = await hasTemplate(pieceId);
  if (!isRenderable(pieceId) && !isTemplate) {
    throw new Error(
      `Piece #${pieceId} has no scene wired into the renderer. The render path is available for the ` +
        `established Field Notes scenes (#004–#006) and any data-driven template piece.`,
    );
  }

  let mode: RenderJob["mode"] = "reuse-approved-audio";
  let audioKind: RenderJob["audioKind"] = "approved-master";
  let audioFile: string | null = null;
  let audioLabel: string | null = null;
  let audioSig = "approved";

  // Template pieces have no approved audio stem — they always render from an uploaded voiceover.
  const useUpload = opts.useUpload || isTemplate;
  if (useUpload) {
    const up = await latestUpload(pieceId);
    if (!up) throw new Error("No uploaded voiceover found for this piece. Upload an MP3 first.");
    mode = "uploaded-vo";
    audioKind = up.kind === "placeholder" ? "placeholder" : "uploaded"; // explicit provenance
    audioFile = up.file;
    audioLabel = up.name;
    audioSig = audioSignature({ name: up.name, bytes: up.bytes, durationSeconds: up.durationSeconds });
  }

  const version = inputVersion({ scriptVersion: await scriptVersion(pieceId), audioSig, templateVersion: TEMPLATE_VERSION });
  const jobs = await listJobs();
  const dup = findActiveDuplicate(jobs, pieceId, version);
  if (dup) return { job: dup, deduped: true };

  const now = new Date().toISOString();
  const job: RenderJob = {
    id: "csjob_" + randomUUID().slice(0, 12),
    pieceId,
    inputVersion: version,
    status: "queued",
    progress: 0,
    stage: "Queued",
    mode,
    audioKind,
    audioFile,
    audioLabel,
    outputFile: null,
    outputRel: null,
    thumbRel: `/content/thumbnails/field-note-${pieceId}-thumbnail.png`,
    error: null,
    attempt: 1,
    pid: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  };
  await writeJob(job);

  // Spawn the detached worker. It reads/updates the job file directly (plain JSON, same shape).
  const worker = path.join(REPO_ROOT, "scripts", "content-studio-render.mjs");
  const child = spawn(process.execPath, [worker, job.id], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  job.pid = child.pid ?? null;
  await writeJob(job);
  child.unref();

  return { job, deduped: false };
}

// If a "rendering"/"queued" job hasn't been touched in a while and its process is gone, it crashed —
// surface that as a failure so the UI can offer retry instead of spinning forever.
const STALE_MS = 10 * 60 * 1000;
export function reconcileStale(job: RenderJob, now = Date.now()): RenderJob {
  if (job.status !== "rendering" && job.status !== "queued") return job;
  const age = now - new Date(job.updatedAt).getTime();
  if (age < STALE_MS) return job;
  const alive = job.pid != null && isProcessAlive(job.pid);
  if (alive) return job;
  return { ...job, status: "failed", error: job.error ?? "Render worker stopped unexpectedly.", updatedAt: new Date(now).toISOString() };
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

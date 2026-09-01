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
import { latestReadyShot } from "./screenshot-jobs";

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
  assertRenderConfigSafe(); // reject a prod misconfig loudly instead of forking Chromium in the web process
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
  let audioKey: string | null = null;
  let audioSha: string | null = null;
  let audioLabel: string | null = null;
  let audioSig = "approved";

  // Template pieces have no approved audio stem — they always render from an uploaded voiceover.
  const useUpload = opts.useUpload || isTemplate;
  if (useUpload) {
    const up = await latestUpload(pieceId);
    if (!up) throw new Error("No uploaded voiceover found for this piece. Upload an MP3 first.");
    mode = "uploaded-vo";
    audioKind = up.kind === "placeholder" ? "placeholder" : "uploaded"; // explicit provenance
    audioFile = up.file; // LEGACY dev fallback path
    audioKey = up.objectKey ?? null; // authoritative cross-process reference (web wrote it via getArtifactStore)
    audioSha = up.sha256 ?? null;
    audioLabel = up.name;
    audioSig = audioSignature({ name: up.name, bytes: up.bytes, durationSeconds: up.durationSeconds });
  }

  // Section I-C: a client video MUST consume its verified website screenshot. Reject generation when that
  // required artifact is absent, and BIND its immutable SHA so the render is reproducible + provenance-true.
  let screenshotKey: string | null = null;
  let screenshotSha: string | null = null;
  const isClient = pieceId.startsWith("client-");
  if (isClient) {
    const tpl = await loadTemplate(pieceId);
    const businessId = (tpl as any)?.businessId as string | undefined;
    const shot = businessId ? await latestReadyShot(businessId, "mobile") : null;
    if (!shot || !shot.outputKey || !shot.sha256) {
      throw new Error("This client video needs its verified website screenshot before you can generate it — the capture isn't ready yet. Re-open the project to prepare it, then try again.");
    }
    screenshotKey = shot.outputKey;
    screenshotSha = shot.sha256;
  }

  // Bind the IMMUTABLE content hashes (audio SHA-256 + screenshot SHA-256) into the input version, so the
  // same inputs always produce the same job identity (reproducible) and any change forces a fresh render.
  const boundSig = [audioSha || audioSig, screenshotSha || "no-shot"].join("~");
  const version = inputVersion({ scriptVersion: await scriptVersion(pieceId), audioSig: boundSig, templateVersion: TEMPLATE_VERSION });
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
    audioKey,
    audioSha,
    audioLabel,
    outputFile: null,
    outputRel: null,
    outputKey: null,
    posterKey: null,
    screenshotKey,
    screenshotSha,
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

  // PRODUCTION: the web endpoint ONLY enqueues (the job is 'queued'); a separate worker service claims
  // and renders it. The web process must NEVER spawn Chromium/ffmpeg in production. LOCAL DEV: spawn a
  // detached renderer so `next dev` alone works end-to-end. `shouldSpawnLocally()` is the single guard,
  // and it fails closed in production (no accidental fallback).
  if (shouldSpawnLocally()) {
    const worker = path.join(REPO_ROOT, "scripts", "content-studio-render.mjs");
    const child = spawn(process.execPath, [worker, job.id], { cwd: REPO_ROOT, detached: true, stdio: "ignore", env: process.env });
    job.pid = child.pid ?? null;
    await writeJob(job);
    child.unref();
  }
  // else: left 'queued' for the worker (scripts/worker-loop.mjs) to claim.

  return { job, deduped: false };
}

// The ONLY place a local renderer is spawned. In production the web process must NEVER fork Chromium —
// not even if CS_RENDER_MODE=local is accidentally set. This function fails closed in production
// regardless of CS_RENDER_MODE; a separate worker service does all rendering.
export function shouldSpawnLocally(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false; // hard rule — worker-only in prod, no override
  if (env.CS_RENDER_MODE === "worker") return false;
  return true; // dev default
}

// Reject an unsafe configuration rather than silently ignoring it: CS_RENDER_MODE=local in production is
// a misconfiguration (the web process would try to render). Called at enqueue so it surfaces loudly.
export function assertRenderConfigSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production" && env.CS_RENDER_MODE === "local") {
    throw new Error("Unsafe Content Studio config: CS_RENDER_MODE=local in production. The web process must NOT render — rendering runs only in the worker service. Unset CS_RENDER_MODE or set it to 'worker'.");
  }
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

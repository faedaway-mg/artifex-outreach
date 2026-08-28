// Content Studio — pure job logic (no I/O, fully testable): the render state machine, deterministic
// input-version binding, duplicate-job guard, and staleness detection. Mirrors the review-video
// job discipline (bounded transitions, version-bound approval) for the social Field Notes pipeline.

import type { JobStatus, RenderJob } from "./types";

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["rendering", "failed"],
  rendering: ["ready", "failed"],
  ready: [], // terminal (a new render creates a NEW job; it never mutates a finished one)
  failed: ["queued"], // retry re-queues
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isActive(status: JobStatus): boolean {
  return status === "queued" || status === "rendering";
}

export function isTerminal(status: JobStatus): boolean {
  return status === "ready" || status === "failed";
}

// Deterministic version of a render's inputs. Same inputs → same version → the same output is reused
// instead of re-rendered. Any change (new script, new audio, new template) yields a new version, which
// marks a prior "ready" output STALE. Kept dependency-free (small FNV-1a hash).
export function inputVersion(parts: {
  scriptVersion: string; // hash/marker of the narration + scene
  audioSig: string; // audio filename+size+duration, or "approved" when reusing the approved stem
  templateVersion: string; // renderer/template version marker
}): string {
  const raw = `${parts.scriptVersion}|${parts.audioSig}|${parts.templateVersion}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "v" + (h >>> 0).toString(16).padStart(8, "0");
}

// Duplicate-job guard: an ACTIVE job for the same piece+inputVersion means a render is already in
// flight — return it instead of starting another (idempotent under repeated clicks).
export function findActiveDuplicate(jobs: RenderJob[], pieceId: string, version: string): RenderJob | null {
  return (
    jobs.find((j) => j.pieceId === pieceId && j.inputVersion === version && isActive(j.status)) ?? null
  );
}

// The current recommended output for a piece = its most recent READY job's output, if any.
export function latestReadyJob(jobs: RenderJob[], pieceId: string): RenderJob | null {
  const ready = jobs
    .filter((j) => j.pieceId === pieceId && j.status === "ready")
    .sort((a, b) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""));
  return ready.length ? ready[ready.length - 1] : null;
}

// A ready output is STALE when the inputs have since changed (a newer active/ready job exists for the
// same piece with a different inputVersion). Surfacing staleness prevents posting an out-of-date file.
export function isOutputStale(jobs: RenderJob[], readyJob: RenderJob): boolean {
  return jobs.some(
    (j) =>
      j.pieceId === readyJob.pieceId &&
      j.inputVersion !== readyJob.inputVersion &&
      (j.createdAt > readyJob.createdAt),
  );
}

export function jobsForPiece(jobs: RenderJob[], pieceId: string): RenderJob[] {
  return jobs
    .filter((j) => j.pieceId === pieceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

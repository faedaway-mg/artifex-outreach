// ─────────────────────────────────────────────────────────────────────────────
// Lucas batch handoff (Batch Pilot M1) — the operational advantage: prepare N videos, then generate
// all Lucas voiceovers in ONE VEED session and drop the files back. The critical safety property is
// that an MP3 can NEVER silently attach to the wrong business: every job carries an expected filename
// containing its JOB ID, and matching is by that id — not by business name. Ambiguous/mismatched files
// are refused, not guessed. Duration is validated against the target. Pure + deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReviewVideoJob } from "../types";

/** A stable slug for the business (display only — matching never depends on it). */
function slug(name: string): string {
  return (name || "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "business";
}

/** The filename the operator's exported Lucas audio should carry. The JOB ID is the match key, so two
 *  businesses can never collide. e.g. "urban-americana__rvjob_ab12cd__lucas.mp3". */
export function expectedAudioFilename(businessName: string, jobId: string): string {
  return `${slug(businessName)}__${jobId}__lucas.mp3`;
}

export interface LucasBatchItem {
  jobId: string;
  leadId: string;
  reviewId: string;
  businessName: string;
  targetSeconds: number;
  narrationWords: number;
  copyBlock: string;         // the VEED-ready paste block
  expectedFilename: string;
}

/** Build the batch handoff list — one copy-paste item per LUCAS_REQUIRED job. Ordered stably by id. */
export function buildLucasBatch(items: Array<{ job: ReviewVideoJob; businessName: string; copyBlock: string }>): LucasBatchItem[] {
  return items
    .filter((x) => x.job.status === "LUCAS_REQUIRED")
    .map((x) => ({
      jobId: x.job.id, leadId: x.job.leadId, reviewId: x.job.reviewId, businessName: x.businessName,
      targetSeconds: x.job.targetSeconds, narrationWords: x.job.narrationWords, copyBlock: x.copyBlock,
      expectedFilename: x.job.expectedAudioFilename || expectedAudioFilename(x.businessName, x.job.id),
    }))
    .sort((a, b) => a.jobId.localeCompare(b.jobId));
}

/** Extract the job-id token from a supplied filename (…__<jobId>__lucas.mp3, or any token that equals a
 *  known job id). Returns null when no id is embedded. */
export function jobIdFromFilename(filename: string, knownIds: string[]): string | null {
  const base = filename.replace(/^.*\//, "");
  const known = new Set(knownIds);
  // Prefer the strict "…__<jobId>__lucas.ext" pattern (job ids may contain '_' and '-', e.g. nanoid).
  const strict = base.match(/__([A-Za-z0-9_-]+)__lucas\.[a-z0-9]+$/i);
  if (strict && known.has(strict[1])) return strict[1];
  // Fallback: a known id embedded between the '__' delimiters, or present verbatim (ids are unique/long).
  const matches = knownIds.filter((id) => base.includes(`__${id}__`) || base.includes(id));
  return matches.length === 1 ? matches[0] : null; // >1 match = ambiguous, never guess
}

export interface AudioMatchResult {
  matched: Array<{ file: string; jobId: string }>;
  ambiguous: string[];   // files that map to 0 or >1 jobs — operator must resolve
  unmatchedJobs: string[]; // LUCAS_REQUIRED jobs with no file
}

/** Deterministically map uploaded files → jobs by embedded job id. A file with no id, or two files for
 *  the same job, are AMBIGUOUS (never silently attached). Pure. */
export function matchAudioToJobs(files: string[], lucasRequiredJobIds: string[]): AudioMatchResult {
  const matched: Array<{ file: string; jobId: string }> = [];
  const ambiguous: string[] = [];
  const perJob = new Map<string, string[]>();
  for (const f of files) {
    const id = jobIdFromFilename(f, lucasRequiredJobIds);
    if (!id) { ambiguous.push(f); continue; }
    perJob.set(id, [...(perJob.get(id) ?? []), f]);
  }
  for (const [jobId, fs] of perJob) {
    if (fs.length === 1) matched.push({ file: fs[0], jobId });
    else ambiguous.push(...fs); // more than one file claims the same job → refuse both
  }
  const claimed = new Set(matched.map((m) => m.jobId));
  const unmatchedJobs = lucasRequiredJobIds.filter((id) => !claimed.has(id));
  return { matched, ambiguous, unmatchedJobs };
}

export type AudioValidation = { ok: boolean; level: "ok" | "warn" | "block"; reason?: string };

/** Validate an imported audio's duration against the job's target. We do NOT verify voice identity —
 *  the operator is the authority on whether the file is Lucas. Zero/near-zero or wildly-off → block. */
export function validateAudioDuration(durationSeconds: number, targetSeconds: number): AudioValidation {
  if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) return { ok: false, level: "block", reason: "unreadable or zero-length audio" };
  if (durationSeconds < 8) return { ok: false, level: "block", reason: `far too short (${durationSeconds.toFixed(1)}s) for a review narration` };
  const ratio = durationSeconds / (targetSeconds || 1);
  if (ratio < 0.55 || ratio > 1.9) return { ok: false, level: "block", reason: `duration ${durationSeconds.toFixed(0)}s is implausible for a ~${Math.round(targetSeconds)}s target` };
  if (ratio < 0.75 || ratio > 1.4) return { ok: true, level: "warn", reason: `duration ${durationSeconds.toFixed(0)}s differs from the ~${Math.round(targetSeconds)}s target` };
  return { ok: true, level: "ok" };
}

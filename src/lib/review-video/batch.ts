// ─────────────────────────────────────────────────────────────────────────────
// Review Video batch orchestration (Batch Pilot M1). Prepares a pilot batch of personalized review
// videos from operator-selected leads: each lead is gated by readiness, a durable job is created
// IDEMPOTENTLY (one active job per lead), and one lead failing never poisons the batch (per-lead
// try/catch). The heavy visual/final rendering is done out-of-band by the render script; the helpers
// here advance the job through its lifecycle and record pilot events. No sending, PRIVATE_ONLY.
// ─────────────────────────────────────────────────────────────────────────────
import { getLead, getBusinessIntelligence, reviewVideoJobsForLead, insertReviewVideoJob, updateReviewVideoJob, getReviewVideoJob } from "../repo";
import type { BusinessProfile } from "../business-intelligence/types";
import { buildQuickReview, cachedBrand } from "../outreach/quick-review";
import { quickReviewApproved } from "../outreach/review-approval";
import { buildNarrationScript } from "../content/narration";
import type { ReviewVideoJob } from "../types";
import { reviewVideoReadiness, type ReviewVideoReadiness } from "./readiness";
import { expectedAudioFilename, validateAudioDuration } from "./lucas-batch";
import { transition } from "./job-state";
import { recordVideoEvent } from "./measurement";

export interface BatchPrepareResult {
  leadId: string;
  jobId: string | null;
  status: ReviewVideoJob["status"] | "NOT_ELIGIBLE";
  readiness: ReviewVideoReadiness | null;
  created: boolean;
  blockers: string[];
}

const ACTIVE = (j: ReviewVideoJob) => j.status !== "FAILED" && j.status !== "DELIVERY_READY";

/** Prepare a batch. For each lead: gate by readiness, then create/reuse a durable job (idempotent).
 *  A lead that throws is isolated and reported — the rest of the batch still processes. Pure of I/O
 *  beyond the repo; never sends. `allowOverride` lets a NEEDS_REVIEW review in only if it's overridable. */
export async function prepareReviewVideoBatch(leadIds: string[], opts: { allowOverride?: boolean; batchId?: string | null } = {}): Promise<BatchPrepareResult[]> {
  const results: BatchPrepareResult[] = [];
  for (const leadId of leadIds) {
    try {
      const lead = await getLead(leadId);
      if (!lead) { results.push({ leadId, jobId: null, status: "NOT_ELIGIBLE", readiness: null, created: false, blockers: ["lead not found"] }); continue; }
      const bi = await getBusinessIntelligence(leadId);
      const profile = ((bi?.profile as any)?.businessProfile ?? null) as BusinessProfile | null;
      if (!profile) { results.push({ leadId, jobId: null, status: "NOT_ELIGIBLE", readiness: null, created: false, blockers: ["no business intelligence / review yet"] }); continue; }
      const review = buildQuickReview(lead, profile, cachedBrand(profile), { approved: await quickReviewApproved(leadId) });
      const readiness = reviewVideoReadiness(review);
      const permitted = readiness.eligible || (readiness.overridable && !!opts.allowOverride);
      if (!permitted) { results.push({ leadId, jobId: null, status: "NOT_ELIGIBLE", readiness, created: false, blockers: readiness.blockers }); continue; }

      // Idempotent: reuse an existing ACTIVE job for this lead rather than creating a duplicate.
      const existing = (await reviewVideoJobsForLead(leadId)).find(ACTIVE);
      if (existing) { results.push({ leadId, jobId: existing.id, status: existing.status, readiness, created: false, blockers: [] }); continue; }

      const script = buildNarrationScript(review);
      const target = Math.round(script.estDurationSeconds());
      const reviewId = `rv-${leadId}`;
      const job = await insertReviewVideoJob({
        leadId, reviewId, batchId: opts.batchId ?? null, status: "PLANNING", rightsState: "PRIVATE_ONLY",
        targetSeconds: target, narrationWords: script.words, expectedAudioFilename: "",
        planKey: null, narrationKey: null, captionsKey: null, previewKey: null,
        audioKey: null, audioDurationSeconds: null, finalKey: null, finalDurationSeconds: null,
        findingIds: review.findings.map((f) => f.id), approvedAt: null, failure: null,
      });
      // Now that we have the id, stamp the expected Lucas filename (id-based → no cross-lead mixups).
      await updateReviewVideoJob(job.id, { expectedAudioFilename: expectedAudioFilename(lead.businessName, job.id) });
      await recordVideoEvent(job.id, "review-video.prepared", { leadId, readiness: readiness.readiness });
      results.push({ leadId, jobId: job.id, status: "PLANNING", readiness, created: true, blockers: [] });
    } catch (e) {
      results.push({ leadId, jobId: null, status: "NOT_ELIGIBLE", readiness: null, created: false, blockers: [`error: ${(e as Error).message}`] });
    }
  }
  return results;
}

async function advance(jobId: string, to: ReviewVideoJob["status"], patch: Partial<ReviewVideoJob> = {}, failure?: { stage: string; message: string }) {
  const job = await getReviewVideoJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  const t = transition(job, to, failure);
  return updateReviewVideoJob(jobId, { ...t, ...patch });
}

/** Visual render finished → the job now needs Lucas. */
export async function markVisualRendered(jobId: string, keys: { planKey?: string; narrationKey?: string; captionsKey?: string; previewKey?: string } = {}) {
  const job = await getReviewVideoJob(jobId);
  if (job && job.status === "PLANNING") await updateReviewVideoJob(jobId, transition(job, "RENDERING_VISUAL"));
  return advance(jobId, "LUCAS_REQUIRED", keys);
}

/** Import the operator's Lucas audio for a job (duration-validated, id-bound). Refuses a blocked file. */
export async function importJobAudio(jobId: string, audio: { audioKey: string; durationSeconds: number }) {
  const job = await getReviewVideoJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  const v = validateAudioDuration(audio.durationSeconds, job.targetSeconds);
  if (!v.ok) throw new Error(`audio rejected: ${v.reason}`);
  const res = await advance(jobId, "AUDIO_IMPORTED", { audioKey: audio.audioKey, audioDurationSeconds: audio.durationSeconds });
  await recordVideoEvent(jobId, "review-video.voice-added", { durationSeconds: audio.durationSeconds, warn: v.level === "warn" });
  return res;
}

/** Final render finished → ready for the operator to review (NOT approved, NOT sent). */
export async function markFinalRendered(jobId: string, final: { finalKey: string; durationSeconds: number }) {
  const job = await getReviewVideoJob(jobId);
  if (job && job.status === "AUDIO_IMPORTED") await updateReviewVideoJob(jobId, transition(job, "RENDERING_FINAL"));
  const res = await advance(jobId, "READY_FOR_REVIEW", { finalKey: final.finalKey, finalDurationSeconds: final.durationSeconds });
  await recordVideoEvent(jobId, "review-video.rendered", { durationSeconds: final.durationSeconds });
  return res;
}

/** Explicit, idempotent operator approval of a rendered video. Approval does NOT send anything. */
export async function approveReviewVideo(jobId: string) {
  const job = await getReviewVideoJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  if (job.status === "APPROVED_PRIVATE" || job.status === "DELIVERY_READY") return job; // idempotent
  const res = await advance(jobId, "APPROVED_PRIVATE");
  await recordVideoEvent(jobId, "review-video.approved", {});
  return res;
}

/** Mark an approved video ready for MANUAL delivery through the existing outreach gates. */
export async function markDeliveryReady(jobId: string) {
  const res = await advance(jobId, "DELIVERY_READY");
  await recordVideoEvent(jobId, "review-video.delivery-ready", {});
  return res;
}

/** Isolate a per-job failure (records the stage + message; other jobs are unaffected). */
export async function failJob(jobId: string, stage: string, message: string) {
  return advance(jobId, "FAILED", {}, { stage, message });
}

/** Retry a FAILED job back to a re-runnable stage (idempotent artifacts are preserved on the record). */
export async function retryJob(jobId: string, to: ReviewVideoJob["status"]) {
  return advance(jobId, to);
}

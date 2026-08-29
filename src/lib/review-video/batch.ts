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
import { getRenderQueue } from "./queue";

const outputPrefix = (jobId: string) => `assets/reviewvideo/${jobId}`;

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
        attemptCount: 0, lastAttemptAt: null, leaseUntil: null, renderVersion: null, approvedVersion: null,
      });
      // Now that we have the id, stamp the expected Lucas filename (id-based → no cross-lead mixups).
      await updateReviewVideoJob(job.id, { expectedAudioFilename: expectedAudioFilename(lead.businessName, job.id) });
      await recordVideoEvent(job.id, "review-video.prepared", { leadId, readiness: readiness.readiness });
      // Enqueue the visual render to run OUTSIDE the request lifecycle (the queue worker drains it).
      getRenderQueue().enqueue({ jobId: job.id, mode: "visual", outputPrefix: outputPrefix(job.id) });
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

/** Import the operator's Lucas audio for a job (duration-validated, id-bound). Refuses a blocked file.
 *  `isTest` marks DEV/TEST audio (not real Lucas) — it renders technically but can never be approved. */
export async function importJobAudio(jobId: string, audio: { audioKey: string; durationSeconds: number; isTest?: boolean }) {
  const job = await getReviewVideoJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  const v = validateAudioDuration(audio.durationSeconds, job.targetSeconds);
  if (!v.ok) throw new Error(`audio rejected: ${v.reason}`);
  const res = await advance(jobId, "AUDIO_IMPORTED", { audioKey: audio.audioKey, audioDurationSeconds: audio.durationSeconds, audioIsTest: !!audio.isTest });
  await recordVideoEvent(jobId, "review-video.voice-added", { durationSeconds: audio.durationSeconds, warn: v.level === "warn" });
  // Valid audio automatically continues to the final render (no separate "start" click needed).
  getRenderQueue().enqueue({ jobId, mode: "final", outputPrefix: outputPrefix(jobId) });
  return res;
}

/** Final render finished → ready for the operator to review (NOT approved, NOT sent). Stamps the render
 *  version so a later approval binds to THIS exact artifact. */
export async function markFinalRendered(jobId: string, final: { finalKey: string; durationSeconds: number; renderVersion?: string }) {
  const job = await getReviewVideoJob(jobId);
  if (job && job.status === "AUDIO_IMPORTED") await updateReviewVideoJob(jobId, transition(job, "RENDERING_FINAL"));
  const res = await advance(jobId, "READY_FOR_REVIEW", { finalKey: final.finalKey, finalDurationSeconds: final.durationSeconds, renderVersion: final.renderVersion ?? `v-${Date.now()}` });
  await recordVideoEvent(jobId, "review-video.final-rendered", { durationSeconds: final.durationSeconds });
  return res;
}

/** Explicit, idempotent operator approval of a rendered video. Binds the approval to the CURRENT render
 *  version, so a regenerated final (different version) is NOT silently approved. Approval does NOT send. */
export async function approveReviewVideo(jobId: string) {
  const job = await getReviewVideoJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  // Hard safety: a video voiced with DEV/TEST audio is a RENDERER acceptance artifact, never a sendable
  // private review. It can never be approved (nor reach DELIVERY_READY).
  if (job.audioIsTest) throw new Error("cannot approve a TEST_AUDIO video — re-render with a real Lucas voiceover first");
  if ((job.status === "APPROVED_PRIVATE" || job.status === "DELIVERY_READY") && job.approvedVersion === job.renderVersion) return job; // idempotent for the SAME version
  const res = await advance(jobId, "APPROVED_PRIVATE", { approvedVersion: job.renderVersion });
  await recordVideoEvent(jobId, "review-video.approved", { version: job.renderVersion });
  return res;
}

/** Re-render a new final (e.g. new Lucas take) — if the job was approved, revoke approval and return it
 *  to READY_FOR_REVIEW because the artifact changed. The operator must re-approve the revision. */
export async function replaceFinal(jobId: string, final: { finalKey: string; durationSeconds: number; renderVersion: string }) {
  const job = await getReviewVideoJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  const patch: Partial<import("../types").ReviewVideoJob> = { finalKey: final.finalKey, finalDurationSeconds: final.durationSeconds, renderVersion: final.renderVersion };
  if (job.status === "APPROVED_PRIVATE" || job.status === "DELIVERY_READY") { patch.status = "READY_FOR_REVIEW"; patch.approvedAt = null; patch.approvedVersion = null; }
  await recordVideoEvent(jobId, "review-video.final-rendered", { durationSeconds: final.durationSeconds, replaced: true });
  return updateReviewVideoJob(jobId, patch);
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

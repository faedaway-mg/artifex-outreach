// ─────────────────────────────────────────────────────────────────────────────
// Render queue (Batch M1.1) — runs the heavy CDP/ffmpeg renders OUTSIDE the request lifecycle, with
// BOUNDED concurrency (Chrome is expensive), deterministic FIFO order, per-job failure isolation,
// idempotent execution (a duplicate enqueue is a no-op; a job already rendering is not re-run), and
// crash recovery (a lease/heartbeat lets a job stuck in RENDERING_* be reclaimed and retried). The queue
// calls the programmatic render contract — never a CLI — and advances job state atomically on the result.
// ─────────────────────────────────────────────────────────────────────────────
import { getReviewVideoJob, updateReviewVideoJob, allReviewVideoJobs } from "../repo";
import type { ReviewVideoJob, ReviewVideoJobStatus } from "../types";
import { transition } from "./job-state";
import { renderReviewVideo, inputVersion, type RenderMode } from "./render-service";
import { recordVideoEvent } from "./measurement";

export interface QueueTask { jobId: string; mode: RenderMode; outputPrefix: string }
export interface QueueOptions { concurrency?: number; leaseMs?: number; now?: () => number }

const DEFAULTS = { concurrency: 1, leaseMs: 10 * 60 * 1000 };

export class RenderQueue {
  private pending: QueueTask[] = [];
  private active = new Set<string>();
  private running = false;
  private readonly concurrency: number;
  private readonly leaseMs: number;
  private readonly now: () => number;

  constructor(opts: QueueOptions = {}) {
    this.concurrency = Math.max(1, opts.concurrency ?? DEFAULTS.concurrency);
    this.leaseMs = opts.leaseMs ?? DEFAULTS.leaseMs;
    this.now = opts.now ?? (() => Date.now());
  }

  size(): number { return this.pending.length + this.active.size; }

  /** Enqueue a render task. Idempotent: a job already queued or actively rendering is not re-added. */
  enqueue(task: QueueTask): boolean {
    if (this.active.has(task.jobId) || this.pending.some((t) => t.jobId === task.jobId)) return false;
    this.pending.push(task);
    return true;
  }

  /** Process the queue to empty, honoring the concurrency cap. Resolves when all tasks settle. */
  async drain(): Promise<void> {
    if (this.running) { await this.idle(); return; }
    this.running = true;
    try {
      const workers: Promise<void>[] = [];
      for (let i = 0; i < this.concurrency; i++) workers.push(this.worker());
      await Promise.all(workers);
    } finally { this.running = false; }
  }

  private async worker(): Promise<void> {
    for (;;) {
      const task = this.pending.shift();
      if (!task) return;
      this.active.add(task.jobId);
      try { await this.run(task); } finally { this.active.delete(task.jobId); }
    }
  }

  private async run(task: QueueTask): Promise<void> {
    const job = await getReviewVideoJob(task.jobId);
    if (!job) return;
    const pre: ReviewVideoJobStatus = task.mode === "visual" ? "PLANNING" : "AUDIO_IMPORTED";
    const rendering: ReviewVideoJobStatus = task.mode === "visual" ? "RENDERING_VISUAL" : "RENDERING_FINAL";
    // Idempotent guard: only run when the job is in the pre-state (or already leased-but-stale for this mode).
    if (job.status !== pre && !(job.status === rendering && this.isStale(job))) return;

    // Lease: move to RENDERING_*, bump attempt, set a lease deadline (heartbeat for recovery).
    const leaseUntil = new Date(this.now() + this.leaseMs).toISOString();
    const t = job.status === pre ? transition(job, rendering) : {}; // already rendering (stale) → keep status
    await updateReviewVideoJob(job.id, { ...t, attemptCount: (job.attemptCount ?? 0) + 1, lastAttemptAt: new Date(this.now()).toISOString(), leaseUntil });

    const res = await renderReviewVideo({
      jobId: job.id, leadId: job.leadId, reviewId: job.reviewId, mode: task.mode,
      audioKey: job.audioKey, audioDurationSeconds: job.audioDurationSeconds, outputPrefix: task.outputPrefix,
    });

    const fresh = (await getReviewVideoJob(job.id))!;
    if (!res.success) {
      await updateReviewVideoJob(job.id, { ...transition(fresh, "FAILED", { stage: rendering, message: res.error ?? "render failed" }), leaseUntil: null });
      await recordVideoEvent(job.id, "review-video.failed", { stage: rendering, message: res.error });
      return;
    }
    // Atomic success: persist artifacts AND advance status in one update so a rendered state never lacks
    // its artifact. Visual → LUCAS_REQUIRED; final → READY_FOR_REVIEW (with the render version stamped).
    if (task.mode === "visual") {
      await updateReviewVideoJob(job.id, { ...transition(fresh, "LUCAS_REQUIRED"), planKey: res.artifacts.planKey ?? fresh.planKey, narrationKey: res.artifacts.narrationKey ?? fresh.narrationKey, captionsKey: res.artifacts.captionsKey ?? fresh.captionsKey, previewKey: res.artifacts.previewKey ?? fresh.previewKey, leaseUntil: null });
      await recordVideoEvent(job.id, "review-video.visual-rendered", { previewKey: res.artifacts.previewKey });
    } else {
      const version = res.inputVersion || inputVersion({ reviewId: job.reviewId, mode: "final", audioKey: job.audioKey, audioDurationSeconds: job.audioDurationSeconds });
      const revoke = fresh.approvedVersion && fresh.approvedVersion !== version && (fresh.status === "APPROVED_PRIVATE" || fresh.status === "DELIVERY_READY");
      await updateReviewVideoJob(job.id, { ...transition(fresh, "READY_FOR_REVIEW"), finalKey: res.artifacts.finalKey ?? fresh.finalKey, finalDurationSeconds: res.durationSeconds ?? fresh.finalDurationSeconds, renderVersion: version, ...(revoke ? { approvedAt: null, approvedVersion: null } : {}), leaseUntil: null });
      await recordVideoEvent(job.id, "review-video.final-rendered", { durationSeconds: res.durationSeconds });
    }
  }

  private isStale(job: ReviewVideoJob): boolean {
    return !job.leaseUntil || Date.parse(job.leaseUntil) < this.now();
  }

  private async idle(): Promise<void> { while (this.running) await new Promise((r) => setTimeout(r, 5)); }
}

// One queue per process (small, bounded). Configurable via env for the pilot.
let singleton: RenderQueue | null = null;
export function getRenderQueue(opts?: QueueOptions): RenderQueue {
  if (!singleton) singleton = new RenderQueue({ concurrency: Number(process.env.REVIEW_VIDEO_CONCURRENCY) || 1, ...opts });
  return singleton;
}
export function __resetRenderQueueForTests(): void { singleton = null; }

/** Recover jobs a crashed worker left stuck in RENDERING_* past their lease → mark FAILED (retryable),
 *  so they can be re-enqueued. Returns the recovered job ids. Idempotent. */
export async function recoverStaleRenders(now: number = Date.now()): Promise<string[]> {
  const jobs = await allReviewVideoJobs();
  const recovered: string[] = [];
  for (const j of jobs) {
    if ((j.status === "RENDERING_VISUAL" || j.status === "RENDERING_FINAL") && (!j.leaseUntil || Date.parse(j.leaseUntil) < now)) {
      await updateReviewVideoJob(j.id, { ...transition(j, "FAILED", { stage: j.status, message: "render interrupted (stale lease) — recoverable" }), leaseUntil: null });
      recovered.push(j.id);
    }
  }
  return recovered;
}

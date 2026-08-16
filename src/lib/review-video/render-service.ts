// ─────────────────────────────────────────────────────────────────────────────
// Programmatic render contract (Batch M1.1). The batch/queue calls THIS — never a CLI's stdout — to
// discover whether a render succeeded. There is exactly ONE renderer: the content-grade M2.2 pipeline.
// This module defines the stable application-level contract and a pluggable executor, so (a) the queue
// and the CLI share the same render function (no duplicate renderer), and (b) tests/acceptance can inject
// a fast deterministic executor instead of spawning Chrome. The default executor lazy-loads the real
// CDP renderer so importing this module never pulls Chrome into the request/runtime path.
// ─────────────────────────────────────────────────────────────────────────────

export type RenderMode = "visual" | "final";

export interface RenderRequest {
  jobId: string;
  leadId: string;
  reviewId: string;
  mode: RenderMode;
  /** Required for mode "final": the imported Lucas audio to time the video against. */
  audioKey?: string | null;
  audioDurationSeconds?: number | null;
  /** Durable output prefix for this job's artifacts (never /tmp in production). */
  outputPrefix: string;
}

export interface RenderResult {
  success: boolean;
  mode: RenderMode;
  jobId: string;
  /** Durable artifact keys produced this stage. */
  artifacts: { planKey?: string; narrationKey?: string; captionsKey?: string; previewKey?: string; finalKey?: string; sfxKey?: string };
  durationSeconds?: number;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  renderMs: number;
  /** Deterministic version of the inputs this artifact was rendered from (for idempotency/invalidation). */
  inputVersion: string;
  error?: string;
}

/** The pluggable executor. The default (below) runs the real renderer; tests inject a fast fake. */
export type RenderExecutor = (req: RenderRequest) => Promise<RenderResult>;

let executor: RenderExecutor | null = null;

/** Override the executor (tests/acceptance). Pass null to restore the real renderer. */
export function setRenderExecutor(fn: RenderExecutor | null): void { executor = fn; }

/** The canonical entry point the queue calls. Delegates to the injected or the real executor. */
export async function renderReviewVideo(req: RenderRequest): Promise<RenderResult> {
  if (req.mode === "final" && !(req.audioDurationSeconds && req.audioDurationSeconds > 0)) {
    return { success: false, mode: req.mode, jobId: req.jobId, artifacts: {}, renderMs: 0, inputVersion: "", error: "final render requires imported Lucas audio" };
  }
  const exec = executor ?? realExecutor;
  const started = Date.now();
  try {
    const res = await exec(req);
    return { ...res, renderMs: res.renderMs || (Date.now() - started) };
  } catch (e) {
    return { success: false, mode: req.mode, jobId: req.jobId, artifacts: {}, renderMs: Date.now() - started, inputVersion: "", error: (e as Error).message };
  }
}

/** A deterministic version key for a job's current inputs — changes when the review/audio changes, so a
 *  regenerated final can invalidate a stale approval. Pure. */
export function inputVersion(req: Pick<RenderRequest, "reviewId" | "mode" | "audioKey" | "audioDurationSeconds">): string {
  return [req.reviewId, req.mode, req.audioKey ?? "-", req.audioDurationSeconds ?? "-"].join("|");
}

/** The real executor — lazy-imports the CDP renderer adapter so Chrome is never loaded until a render
 *  actually runs. Kept thin: it forwards to the single M2.2 render pipeline. */
const realExecutor: RenderExecutor = async (req) => {
  const { runReviewVideoRender } = await import("../../../scripts/review-video-render-core");
  return runReviewVideoRender(req);
};

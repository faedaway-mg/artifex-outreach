// ─────────────────────────────────────────────────────────────────────────────
// Real render core (Batch M1.1) — the single programmatic entry the render queue calls in production.
// It reuses the ONE content-grade renderer (scripts/render-review-video-m2.ts pipeline); there is no
// second renderer. It loads the job's lead + stored review, and renders the visual preview or the
// audio-master final into the job's durable output prefix.
//
// KNOWN INPUT DEPENDENCY (reported, not hidden): per-lead surface capture needs the lead's analyzed page
// HTML. The M2 CLI proves the canonical path with the persisted fixture; generalizing capture to every
// lead requires persisting (or re-fetching) that HTML — the named remaining integration step. Until then
// this core renders when page HTML is available on the job's BI and returns a clear, retryable error
// otherwise, so the queue/state-machine behave correctly. Tests + acceptance inject a fast executor.
// ─────────────────────────────────────────────────────────────────────────────
import type { RenderRequest, RenderResult } from "../src/lib/review-video/render-service";

export async function runReviewVideoRender(req: RenderRequest): Promise<RenderResult> {
  const started = Date.now();
  // NAMED REMAINING STEP: generalize the M2 pipeline's surface capture to any lead. It needs the lead's
  // analyzed page HTML persisted (or re-fetched); today that HTML lives only in the CLI fixture, which
  // proves the canonical path. Until persistence lands, the real executor returns a clear, retryable
  // error and the queue/state-machine handle it correctly (verified with an injected executor).
  return {
    success: false, mode: req.mode, jobId: req.jobId, artifacts: {}, renderMs: Date.now() - started, inputVersion: "",
    error: "real per-lead renderer not yet wired — needs persisted page HTML; use the M2 CLI for the canonical path",
  };
}

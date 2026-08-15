// ─────────────────────────────────────────────────────────────────────────────
// Review Video job lifecycle (Batch Pilot M1) — a small deterministic state machine. The key
// distinction the operator cares about: READY_FOR_REVIEW (rendering succeeded) is NOT APPROVED_PRIVATE
// (a human watched it and approved) is NOT sent (delivery is separate + human-controlled). Invalid
// transitions are rejected; FAILED is reachable from any active stage and can retry back. Pure.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReviewVideoJobStatus, ReviewVideoJob } from "../types";

/** Valid forward transitions per state. FAILED is added to every active state below. */
const BASE: Record<ReviewVideoJobStatus, ReviewVideoJobStatus[]> = {
  NOT_STARTED: ["PLANNING"],
  PLANNING: ["RENDERING_VISUAL"],
  RENDERING_VISUAL: ["LUCAS_REQUIRED"],
  LUCAS_REQUIRED: ["AUDIO_IMPORTED"],
  AUDIO_IMPORTED: ["RENDERING_FINAL"],
  RENDERING_FINAL: ["READY_FOR_REVIEW"],
  READY_FOR_REVIEW: ["APPROVED_PRIVATE"],
  APPROVED_PRIVATE: ["DELIVERY_READY"],
  DELIVERY_READY: [],
  FAILED: [], // retry targets added below
};

// A failure can happen during any active production stage; a FAILED job can retry back to the stage
// that produces its next artifact (idempotent re-run), never skipping ahead.
const CAN_FAIL: ReviewVideoJobStatus[] = ["PLANNING", "RENDERING_VISUAL", "LUCAS_REQUIRED", "AUDIO_IMPORTED", "RENDERING_FINAL"];
const RETRY_TO: ReviewVideoJobStatus[] = ["PLANNING", "RENDERING_VISUAL", "AUDIO_IMPORTED", "RENDERING_FINAL"];

export function allowedTransitions(from: ReviewVideoJobStatus): ReviewVideoJobStatus[] {
  const out = [...BASE[from]];
  if (CAN_FAIL.includes(from)) out.push("FAILED");
  if (from === "FAILED") out.push(...RETRY_TO);
  return out;
}

export function canTransition(from: ReviewVideoJobStatus, to: ReviewVideoJobStatus): boolean {
  return allowedTransitions(from).includes(to);
}

/** Apply a transition to a job, or throw if invalid. Returns the patch (status + cleared/set fields).
 *  Pure — the caller persists. Moving OUT of FAILED clears the failure; entering FAILED records it. */
export function transition(job: Pick<ReviewVideoJob, "status">, to: ReviewVideoJobStatus, failure?: { stage: string; message: string }): Partial<ReviewVideoJob> {
  if (!canTransition(job.status, to)) throw new Error(`invalid review-video transition: ${job.status} → ${to}`);
  const patch: Partial<ReviewVideoJob> = { status: to };
  if (to === "FAILED") patch.failure = failure ?? { stage: job.status, message: "unknown failure" };
  else patch.failure = null;
  if (to === "APPROVED_PRIVATE") patch.approvedAt = new Date().toISOString();
  return patch;
}

/** The next operator-facing action for a job state (drives the batch board). */
export function nextAction(status: ReviewVideoJobStatus): string {
  switch (status) {
    case "NOT_STARTED": return "Prepare video";
    case "PLANNING": case "RENDERING_VISUAL": return "Rendering visual…";
    case "LUCAS_REQUIRED": return "Add Lucas audio";
    case "AUDIO_IMPORTED": case "RENDERING_FINAL": return "Rendering final…";
    case "READY_FOR_REVIEW": return "Preview & approve";
    case "APPROVED_PRIVATE": return "Mark delivery-ready";
    case "DELIVERY_READY": return "Send through outreach (manual)";
    case "FAILED": return "Retry";
  }
}

/** Terminal-for-the-pilot states (no further automatic work). */
export function isTerminal(status: ReviewVideoJobStatus): boolean {
  return status === "DELIVERY_READY" || status === "FAILED";
}

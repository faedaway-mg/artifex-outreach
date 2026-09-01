// Content Studio — HONEST render lifecycle (section I-D). One operator-facing state machine over a piece
// and its jobs, derived (never guessed) from real server state. The contract is exactly seven states.
// Crucially: READY is only ever reported when a verified output artifact actually exists — a failed
// history never masquerades as ready, and a queued/rendering job never claims done.

export type RenderState =
  | "NEEDS_AUDIO"
  | "READY_TO_GENERATE"
  | "QUEUED"
  | "RENDERING"
  | "READY"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export interface LifecycleJob {
  status: "queued" | "rendering" | "ready" | "failed";
  attempt: number;
  inputVersion?: string;
  stage?: string;
  updatedAt?: string;
  startedAt?: string | null;
  error?: string | null;
}

export interface LifecycleInput {
  renderable: boolean;
  isClient: boolean;
  hasAudio: boolean;
  hasScreenshot: boolean;     // relevant only for client videos (a verified capture is required to generate)
  evidenceState?: "evidence-backed" | "needs-evidence" | null; // client videos: gate on stored evidence state
  hasVerifiedOutput: boolean; // a ready job WITH a durable, verified output artifact exists
  latestJob: LifecycleJob | null;
  maxAttempts?: number;
}

export interface LifecycleResult {
  state: RenderState;
  label: string;
  reason: string;
  attempt: number | null;
  inputVersion: string | null;
  since: string | null;
}

const LABELS: Record<RenderState, string> = {
  NEEDS_AUDIO: "Needs audio",
  READY_TO_GENERATE: "Ready to generate",
  QUEUED: "Queued",
  RENDERING: "Rendering",
  READY: "Ready",
  FAILED_RETRYABLE: "Failed — retry available",
  FAILED_FINAL: "Failed — no retries left",
};

export function renderLifecycle(input: LifecycleInput): LifecycleResult {
  const maxAttempts = input.maxAttempts ?? 3;
  const j = input.latestJob;
  const base = (state: RenderState, reason: string): LifecycleResult => ({
    state, label: LABELS[state], reason,
    attempt: j?.attempt ?? null, inputVersion: j?.inputVersion ?? null, since: j?.updatedAt ?? null,
  });

  // Active work wins — but ONLY if there isn't already a verified output (a re-render over a ready piece
  // still shows progress; a stale failed record never hides a real ready output).
  if (j?.status === "rendering") return base("RENDERING", j.stage ? String(j.stage) : "Rendering frames.");
  if (j?.status === "queued") return base("QUEUED", "Queued — waiting for a render worker to claim it.");

  if (input.hasVerifiedOutput) return base("READY", "A verified video artifact exists and passed checks.");

  if (j?.status === "failed") {
    const terminal = j.attempt >= maxAttempts;
    return base(terminal ? "FAILED_FINAL" : "FAILED_RETRYABLE", j.error || (terminal ? "Render failed after the maximum attempts." : "Render failed — a retry is available."));
  }

  // No active job, no output, no failure → what's missing before the one Generate action?
  if (input.renderable && !input.hasAudio) return base("NEEDS_AUDIO", "Upload a voiceover to enable Generate.");
  if (input.isClient && !input.hasScreenshot) return base("READY_TO_GENERATE", "Audio is ready; the verified website screenshot is still being captured — Generate unlocks the moment it lands.");
  return base("READY_TO_GENERATE", "Script, screenshot and narration are present — one Generate away.");
}

// A client render can only START when every required input is present + owned. The Generate endpoint uses
// this so the UI and the server agree on exactly when the single action is allowed.
export function canGenerate(input: Pick<LifecycleInput, "renderable" | "isClient" | "hasAudio" | "hasScreenshot" | "evidenceState">): { ok: boolean; reason?: string } {
  if (!input.renderable) return { ok: false, reason: "This piece has no renderer wired." };
  // A client video whose evidence hasn't cleared the gate must not offer Generate — the chip says "needs
  // evidence", the server refuses, and the button agrees. Deeper site capture is the unblock, not a click.
  if (input.isClient && input.evidenceState === "needs-evidence") return { ok: false, reason: "Needs evidence — no directly-observed finding yet. Capture the site deeper before generating." };
  if (!input.hasAudio) return { ok: false, reason: "Upload a voiceover first." };
  if (input.isClient && !input.hasScreenshot) return { ok: false, reason: "The verified website screenshot isn't ready yet." };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — EXPLAINER QA STORE (persisted media-QA snapshots + human reviews).
//
// Two small registries persisted in the Settings JSONB singleton (no migration):
//   • breakbot.explainerMediaQa — the last Breakbot media-timeline QA result per scope,
//     tied to the exact assetRevision it inspected. Produced by the local ops script
//     scripts/breakbot-explainer-qa.ts (ffmpeg is a local/CI tool, not a prod runtime
//     dependency), consumed read-only by the Explainer QA Gallery.
//   • breakbot.explainerReviews — the operator's creative "Reviewed — Looks Good" /
//     "Needs Fix", tied to the assetRevision. A review is valid ONLY for the revision it
//     was made against, so it RESETS automatically when the asset changes (§9/§30). A
//     human review NEVER overrides a Breakbot blocker — it is an ADDITIONAL sign-off.
// ─────────────────────────────────────────────────────────────────────────────
import { getSettings, updateSettings, appendAudit } from "../repo";
import type { MediaStatus } from "./media-qa";

export interface MediaQaSnapshot {
  scope: string;
  /** The exact asset revision this snapshot inspected (staleness detection). */
  assetRevision: string;
  status: MediaStatus;
  aliveThroughPct: number;
  orientation: "landscape" | "portrait" | null;
  aspectRatio: string | null;
  durationSeconds: number | null;
  findings: Array<{ kind: string; severity: "BLOCKER" | "WARNING"; detail: string }>;
  /** Per-sample evidence across the timeline (§26). */
  timeline: Array<{ pct: number; atSeconds: number; byteSize: number; alive: boolean }>;
  probedAt: string;
  /** Where the probe read from (local master path or served URL). */
  source: string;
}

export type ReviewVerdict = "reviewed" | "needs-fix";

export interface ExplainerReview {
  scope: string;
  /** The review is valid ONLY for this asset revision — it resets when the asset changes. */
  assetRevision: string;
  verdict: ReviewVerdict;
  note?: string | null;
  actor: string;
  reviewedAt: string;
}

// ── media-qa snapshots ────────────────────────────────────────────────────────
async function readSnapshots(): Promise<Record<string, MediaQaSnapshot>> {
  const s = (await getSettings()) as any;
  return (s.breakbot?.explainerMediaQa ?? {}) as Record<string, MediaQaSnapshot>;
}

export async function getMediaQaSnapshot(scope: string): Promise<MediaQaSnapshot | null> {
  return (await readSnapshots())[scope] ?? null;
}

export async function listMediaQaSnapshots(): Promise<Record<string, MediaQaSnapshot>> {
  return readSnapshots();
}

export async function setMediaQaSnapshot(snap: MediaQaSnapshot, actor: string): Promise<void> {
  const s = (await getSettings()) as any;
  const breakbot = (s.breakbot ?? {}) as any;
  const m = { ...(breakbot.explainerMediaQa ?? {}) } as Record<string, MediaQaSnapshot>;
  m[snap.scope] = snap;
  await updateSettings({ breakbot: { ...breakbot, explainerMediaQa: m } } as any);
  await appendAudit({ action: "breakbot.explainer_media_qa_set", actor, targetType: "trust_video", targetId: snap.scope, meta: { status: snap.status, assetRevision: snap.assetRevision }, ip: null });
}

// ── human reviews ─────────────────────────────────────────────────────────────
async function readReviews(): Promise<Record<string, ExplainerReview>> {
  const s = (await getSettings()) as any;
  return (s.breakbot?.explainerReviews ?? {}) as Record<string, ExplainerReview>;
}

export async function getExplainerReview(scope: string): Promise<ExplainerReview | null> {
  return (await readReviews())[scope] ?? null;
}

export async function listExplainerReviews(): Promise<Record<string, ExplainerReview>> {
  return readReviews();
}

export async function setExplainerReview(review: ExplainerReview, actor: string): Promise<void> {
  const s = (await getSettings()) as any;
  const breakbot = (s.breakbot ?? {}) as any;
  const m = { ...(breakbot.explainerReviews ?? {}) } as Record<string, ExplainerReview>;
  m[review.scope] = review;
  await updateSettings({ breakbot: { ...breakbot, explainerReviews: m } } as any);
  await appendAudit({ action: "breakbot.explainer_review_set", actor, targetType: "trust_video", targetId: review.scope, meta: { verdict: review.verdict, assetRevision: review.assetRevision }, ip: null });
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — EXPLAINER QA GALLERY READ-MODEL (mandate §9/§30 + prior QA-gallery amendment).
//
// PURE. Combines the resolved explainer library (canonical per scope), the persisted
// Breakbot media-timeline snapshots, and the operator's human reviews into ONE gallery
// model the /launch/explainers page renders. No I/O — the page does the awaits and hands
// this function plain data, so the derivation is deterministic + unit-testable.
//
// INVARIANTS enforced here:
//   • EVERY required scope appears; a scope with no canonical asset shows MISSING and is
//     NEVER dropped (§9).
//   • Breakbot technical/product correctness comes FIRST; the operator's creative review
//     is an ADDITIONAL sign-off that can NEVER flip a Breakbot BLOCKER to acceptable (§30).
//   • A human review is valid ONLY for the exact asset revision it was made against, so it
//     RESETS automatically when the asset changes.
//   • A media snapshot taken against an older revision reads as STALE (not PASS).
// ─────────────────────────────────────────────────────────────────────────────
import type { ResolvedExplainer } from "../quick-fix/explainer-library";
import { EXPLAINER_ORIENTATION } from "../quick-fix/explainer-library";
import type { MediaStatus } from "./media-qa";
import type { MediaQaSnapshot, ExplainerReview } from "./explainer-qa-store";

export type CardStatus = "PASS" | "WARNING" | "BLOCKED" | "MISSING" | "STALE" | "NOT_RUN";
export type MediaState = MediaStatus | "NOT_RUN" | "STALE";

export interface GalleryCard {
  scope: string;
  title: string;
  purpose: string;
  source: ResolvedExplainer["source"];
  voice: ResolvedExplainer["voice"];
  orientation: "landscape" | "portrait" | null;
  expectedOrientation: "landscape";
  aspectRatio: string | null;
  durationSeconds: number | null;
  audioSeconds: number | null;
  servedMp4Url: string | null;
  posterUrl: string | null;
  captionsUrl: string | null;
  captionsVerified: boolean;
  visualMaster: string | null;
  voiceoverId: string | null;
  assetRevision: string | null;
  /** The overall badge: Breakbot technical correctness is authoritative. */
  status: CardStatus;
  /** The media-QA state specifically (distinct from the human review). */
  mediaState: MediaState;
  aliveThroughPct: number | null;
  breakbotFindings: Array<{ kind: string; severity: "BLOCKER" | "WARNING"; detail: string }>;
  timeline: MediaQaSnapshot["timeline"] | null;
  breakbotProbedAt: string | null;
  /** The human review (creative sign-off) and whether it is valid for THIS revision. */
  humanReview: { verdict: ExplainerReview["verdict"]; valid: boolean; note: string | null; actor: string; reviewedAt: string } | null;
  /** True when media is healthy but there is no valid operator sign-off yet. */
  needsHumanReview: boolean;
}

export interface GalleryModel {
  cards: GalleryCard[];
  summary: {
    total: number;
    pass: number;
    warning: number;
    blocked: number;
    missing: number;
    stale: number;
    notRun: number;
    /** Scopes whose media is healthy (PASS/WARNING) and not missing/stale/blocked. */
    healthy: number;
    /** Scopes with a valid operator sign-off for the current revision. */
    reviewed: number;
  };
  /** True only when every required scope is present + Breakbot-healthy (§9). */
  coverageComplete: boolean;
}

const PURPOSE: Record<string, string> = {
  "contact-form-lead-capture": "Explains the Quick-Fix process for lead-capture / contact-form repairs on the offer page.",
  "cta-conversion": "The evergreen trust/explainer shown on a conversion-scope offer page.",
  "mobile-responsive": "Explains the Quick-Fix process for mobile/responsive fixes on the offer page.",
  "accessibility": "Explains the Quick-Fix process for accessibility remediations on the offer page.",
  "analytics-tracking": "Explains the Quick-Fix process for analytics/tracking repairs on the offer page.",
  "cms-technical": "Explains the Quick-Fix process for CMS/technical fixes on the offer page.",
  "seo-metadata": "Explains the Quick-Fix process for technical SEO/metadata fixes on the offer page.",
  "homepage-sprint": "Explains the contained homepage-sprint scope on the offer page.",
  "fix-scan": "Explains the Fix Scan diagnostic offer on the offer page.",
};

function mediaStateFor(resolved: ResolvedExplainer, snap: MediaQaSnapshot | null): { state: MediaState; findings: GalleryCard["breakbotFindings"]; alive: number | null; timeline: MediaQaSnapshot["timeline"] | null; probedAt: string | null } {
  if (!snap) return { state: "NOT_RUN", findings: [], alive: null, timeline: null, probedAt: null };
  if (resolved.assetRevision && snap.assetRevision !== resolved.assetRevision) {
    // The snapshot describes a DIFFERENT (older) asset revision — do not trust it.
    return { state: "STALE", findings: snap.findings, alive: snap.aliveThroughPct, timeline: snap.timeline, probedAt: snap.probedAt };
  }
  return { state: snap.status, findings: snap.findings, alive: snap.aliveThroughPct, timeline: snap.timeline, probedAt: snap.probedAt };
}

/** Build one card. PURE. */
export function buildCard(resolved: ResolvedExplainer, snap: MediaQaSnapshot | null, review: ExplainerReview | null): GalleryCard {
  const media = mediaStateFor(resolved, snap);

  // Overall badge — Breakbot technical correctness is authoritative and comes first.
  let status: CardStatus;
  if (resolved.source === "missing") status = "MISSING";
  else if (media.state === "BLOCKED") status = "BLOCKED";
  else if (media.state === "STALE") status = "STALE";
  else if (media.state === "NOT_RUN") status = "NOT_RUN";
  else if (media.state === "WARNING") status = "WARNING";
  else status = "PASS";

  // Orientation contract: a resolved orientation that contradicts the landscape contract
  // downgrades to at least WARNING even if media QA has not run (defensive, §8).
  if (status === "PASS" && resolved.orientation && resolved.orientation !== EXPLAINER_ORIENTATION) status = "WARNING";
  // Captions not verified against the final narration → a (non-blocking) warning.
  if (status === "PASS" && resolved.source !== "missing" && !resolved.captionsVerified) status = "WARNING";

  // Human review is valid ONLY for the current asset revision (resets on change). It is
  // an additional sign-off and can NEVER make a BLOCKED/MISSING card acceptable.
  const reviewValid = !!review && !!resolved.assetRevision && review.assetRevision === resolved.assetRevision;
  const humanReview = review
    ? { verdict: review.verdict, valid: reviewValid, note: review.note ?? null, actor: review.actor, reviewedAt: review.reviewedAt }
    : null;
  const passedMedia = status === "PASS" || status === "WARNING";
  const needsHumanReview = passedMedia && !(reviewValid && review!.verdict === "reviewed");

  return {
    scope: resolved.scope,
    title: resolved.title,
    purpose: PURPOSE[resolved.scope] ?? `Evergreen explainer for ${resolved.scope}.`,
    source: resolved.source,
    voice: resolved.voice,
    orientation: resolved.orientation,
    expectedOrientation: EXPLAINER_ORIENTATION,
    aspectRatio: resolved.orientation === "landscape" ? "16:9" : resolved.orientation === "portrait" ? "9:16" : null,
    durationSeconds: resolved.durationSeconds,
    audioSeconds: resolved.audioSeconds,
    servedMp4Url: resolved.servedMp4Url,
    posterUrl: resolved.posterUrl,
    captionsUrl: resolved.captionsUrl,
    captionsVerified: resolved.captionsVerified,
    visualMaster: resolved.visualMaster,
    voiceoverId: resolved.voiceoverId,
    assetRevision: resolved.assetRevision,
    status,
    mediaState: media.state,
    aliveThroughPct: media.alive,
    breakbotFindings: media.findings,
    timeline: media.timeline,
    breakbotProbedAt: media.probedAt,
    humanReview,
    needsHumanReview,
  };
}

/** Build the whole gallery model. PURE. */
export function buildExplainerGallery(
  resolved: ResolvedExplainer[],
  snapshots: Record<string, MediaQaSnapshot>,
  reviews: Record<string, ExplainerReview>,
): GalleryModel {
  const cards = resolved.map((r) => buildCard(r, snapshots[r.scope] ?? null, reviews[r.scope] ?? null));
  const summary = {
    total: cards.length,
    pass: cards.filter((c) => c.status === "PASS").length,
    warning: cards.filter((c) => c.status === "WARNING").length,
    blocked: cards.filter((c) => c.status === "BLOCKED").length,
    missing: cards.filter((c) => c.status === "MISSING").length,
    stale: cards.filter((c) => c.status === "STALE").length,
    notRun: cards.filter((c) => c.status === "NOT_RUN").length,
    healthy: cards.filter((c) => c.status === "PASS" || c.status === "WARNING").length,
    reviewed: cards.filter((c) => c.humanReview?.valid && c.humanReview.verdict === "reviewed").length,
  };
  const coverageComplete = summary.missing === 0 && summary.blocked === 0 && summary.stale === 0 && summary.healthy === summary.total;
  return { cards, summary, coverageComplete };
}

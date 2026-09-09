// ─────────────────────────────────────────────────────────────────────────────
// PERSONALIZED DIAGNOSTIC VIDEO — canonical object, evidence-derived storyboard,
// readiness, staleness, and the attempted-use truth check.
//
// ONE EVIDENCE TRUTH → VIDEO. The personalized diagnostic video derives from the
// SAME canonical EvidencePackage the email claim, screenshots, diagnostic PDF and
// offer page derive from. It EXPLAINS existing evidence — it NEVER invents a new
// defect and NEVER re-diagnoses. Its opening claim comes from the shared
// ExperienceFrame, so "I tried to book online…" appears ONLY when the evidence
// genuinely supports an attempted action (attemptSupported); otherwise the video
// opens with the honest observational frame.
//
// A personalized video is READY only when a real rendered asset exists AND it was
// rendered against the CURRENT evidence + narration + render versions AND it is
// playable (has an mp4 + a poster + a positive duration). Any drift → STALE. No
// generator output → NOT_GENERATED. The evergreen process video can NEVER satisfy
// this — it is a separate asset with a different job (who Artifex is / how the fix
// works), and this module never references it.
//
// This module is PURE: it derives, versions, and judges. It performs no render, no
// I/O, no writes. The render worker (scripts/personalized-video-render.ts) consumes
// the storyboard; the store persists the record; Breakbot + evidence-package read
// the readiness. No spoken audio is synthesized in v1 — the authoritative narration
// script is rendered as on-screen kinetic text and is the caption source, so there
// is no synthetic-voice / founder-impersonation surface at all.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import type { QuickFixOffer } from "./types";
import type { EvidencePackage, EvidenceFinding, EvidenceAssetRef, AssetStatus } from "./evidence-package";
import { evidenceVersion } from "./evidence-truth";
import { experienceFrameForOffer, type ExperienceFrame } from "./experience-frame";
import { shortName } from "../content-studio/client-narration";

// Bump when the object/version-binding rules change so stored records + Breakbot stay aligned.
export const PERSONALIZED_VIDEO_VERSION = "pvid.v1";
// Bump when the storyboard/narration derivation changes (invalidates rendered narration).
export const PV_NARRATION_VERSION = "pv-narr.v1";
// Bump when the visual render recipe changes (invalidates rendered pixels).
export const PV_RENDER_VERSION = "pv-render.v1";

export type PersonalizedVideoStatus =
  | "NOT_GENERATED" // no render has been attempted for the current inputs
  | "QUEUED" // a render job is enqueued, not started
  | "RENDERING" // a render job is in progress
  | "READY" // a playable asset exists, bound to current evidence + narration + render
  | "STALE" // an asset exists but evidence/narration/render moved underneath it
  | "FAILED" // the last render attempt failed (failureReason set)
  | "BLOCKED"; // cannot generate (e.g. no evidence-backed findings to explain)

// The statuses that are honestly "the customer would have a personalized video".
export function isPersonalizedVideoReady(status: PersonalizedVideoStatus): boolean {
  return status === "READY";
}

/** The persisted per-offer personalized-video record (lives on StoredOffer). */
export interface PersonalizedDiagnosticVideoRecord {
  // Identity / bindings — the video is meaningless unless bound to THIS offer's truth.
  offerId: string;
  offerVersion: string;
  leadId: string;
  company: string;
  website: string | null;
  evidenceVersion: string; // the evidence hash this render was produced against
  narrationVersion: string;
  renderVersion: string;
  personalizedVideoVersion: string;

  status: PersonalizedVideoStatus;

  // Digests — detect drift without re-reading the whole package.
  sourceEvidenceDigest: string; // == evidenceVersion at render time (kept explicit for audit)
  narrationDigest: string; // hash of the authoritative narration script
  renderedAssetDigest: string | null; // hash/etag of the rendered mp4, when READY

  // Asset locations (app routes or storage refs) — never a raw secret.
  mp4Url: string | null;
  posterUrl: string | null;
  captionsUrl: string | null;

  durationSeconds: number | null;

  // Captions: authoritative script → verified transcript → VTT. Off unless verified.
  captionVersion: string | null;
  captionsVerified: boolean;

  // Lifecycle timestamps + failure.
  idempotencyKey: string;
  queuedAt: string | null;
  generatedAt: string | null;
  verifiedAt: string | null;
  failureReason: string | null;
}

// ── Storyboard ───────────────────────────────────────────────────────────────
export type SceneRole =
  | "context" // business context / the action we set out to take
  | "observed" // what happened / what we found
  | "evidence" // show the actual captured website
  | "friction" // point to the exact friction, plain language
  | "repair" // the practical change we'd make
  | "handoff"; // hand back to the offer below

export type SceneVisualKind = "screenshot" | "kinetic-text" | "repair-concept";

export interface SceneVisual {
  kind: SceneVisualKind;
  /** For kind==="screenshot": the EvidenceScreenshot id to composite (real capture). */
  screenshotId: string | null;
  /** Plain on-screen label ("Your homepage on a phone"). */
  label: string;
  /** True ONLY for kind==="repair-concept": must be watermarked "Example / Illustrative". */
  illustrative: boolean;
}

export interface VideoScene {
  role: SceneRole;
  /** The authoritative narration line for this scene (also the caption source). */
  narration: string;
  visual: SceneVisual;
  /** True when this line makes an attempted-use claim ("I tried to …"). */
  claimsAttemptedUse: boolean;
  /** Estimated seconds on screen (paced from spoken length; ~2.6 wps). */
  seconds: number;
}

export interface VideoStoryboard {
  offerId: string;
  company: string;
  frameVersion: string;
  narrationVersion: string;
  /** Whether the storyboard is legitimately buildable (≥1 evidence-backed finding). */
  buildable: boolean;
  /** Why not, when buildable === false. */
  blockedReason: string | null;
  scenes: VideoScene[];
  /** The full authoritative narration script (scene lines joined) — the caption source. */
  narrationScript: string;
  estimatedSeconds: number;
  /** Whether every attempted-use claim in the script is supported by the frame. */
  attemptedUseHonest: boolean;
}

const WORDS_PER_SECOND = 2.6; // conversational pace; used only for on-screen pacing
function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
function sceneSeconds(text: string): number {
  // Floor of ~2.2s so a short line still reads; round to a tenth.
  return Math.max(2.2, Math.round((words(text) / WORDS_PER_SECOND) * 10) / 10);
}

// The single canonical "I tried to …" opener detector — mirrors experience-frame phrasing.
const ATTEMPTED_USE_RX = /\bi tried to\b|\bwe tried to\b/i;
export function lineClaimsAttemptedUse(text: string): boolean {
  return ATTEMPTED_USE_RX.test(text);
}

// The plain page label a screenshot carries in the package, or a safe default.
function labelForScreenshot(pkg: EvidencePackage, screenshotId: string | null): string {
  if (!screenshotId) return "Your website";
  const shot = pkg.screenshots.find((s) => s.id === screenshotId);
  return shot?.pageLabel ?? "Your website";
}

/**
 * Derive the personalized-video storyboard from the canonical evidence package and
 * the shared experience frame. Deterministic + truthful:
 *   • Opens from the SAME frame the email/offer/PDF open from (attempted-use ONLY
 *     when frame.attemptSupported).
 *   • Shows the REAL captured screenshot when one is READY; never a fabricated one.
 *   • Points to the primary finding's plain-language friction.
 *   • Describes the practical repair from the offer's own scope (no new promise).
 *   • Hands to the offer. Never invents a new defect; explains existing evidence only.
 * Buildable only when ≥1 evidence-backed finding exists (else nothing honest to show).
 */
export function buildVideoStoryboard(
  pkg: EvidencePackage,
  frame: ExperienceFrame,
  offer: QuickFixOffer,
): VideoStoryboard {
  const short = shortName(pkg.company || offer.companyName);
  const primary: EvidenceFinding | null = pkg.findings[0] ?? null;

  if (!primary) {
    return {
      offerId: offer.offerId,
      company: pkg.company,
      frameVersion: frame.version,
      narrationVersion: PV_NARRATION_VERSION,
      buildable: false,
      blockedReason: "No evidence-backed findings — there is nothing to walk through honestly.",
      scenes: [],
      narrationScript: "",
      estimatedSeconds: 0,
      attemptedUseHonest: true,
    };
  }

  // Prefer the READY screenshot the primary finding links to; else any READY shot.
  const readyShots = pkg.screenshots.filter((s) => s.status === "READY");
  const linkedShotId =
    primary.screenshotId && readyShots.some((s) => s.id === primary.screenshotId)
      ? primary.screenshotId
      : (readyShots[0]?.id ?? null);

  // 1) CONTEXT / ACTION — verbatim from the shared frame (attempted-use truth honored).
  const contextLine = frame.attemptSupported
    ? `We tried to ${frame.attemptedAction} on ${short}'s website.`
    : `We took a close look at ${short}'s website.`;

  // 2) OBSERVED — what happened, from the frame's friction (no new fact).
  const observedLine = frame.attemptSupported
    ? `From the pages we checked, we ${frame.friction}.`
    : frame.offerHeroSubline;

  // 3) EVIDENCE — show the real capture (or, honestly, say we reviewed the live pages).
  const evidenceLine = linkedShotId
    ? `Here's ${labelForScreenshot(pkg, linkedShotId).toLowerCase()} — the page exactly as it loads today.`
    : `We reviewed your live pages directly.`;

  // 4) FRICTION — the primary finding in plain owner language (already restated in pkg).
  const frictionLine = primary.plain;

  // 5) REPAIR — the practical change, from the offer's own customer-facing solution.
  const repairText = (offer.scope.proposedSolution || "make a focused fix").trim();
  const repairLine = `We'd ${repairText.charAt(0).toLowerCase()}${repairText.slice(1).replace(/[.!?]+$/, "")}, then check it on phone and desktop.`;

  // 6) HANDOFF — to the offer below (no price spoken; value framing only).
  const handoffLine = `Below you'll find exactly what we found, what the fix includes, and the next step.`;

  const scenes: VideoScene[] = [
    {
      role: "context",
      narration: contextLine,
      visual: { kind: "kinetic-text", screenshotId: null, label: short, illustrative: false },
      claimsAttemptedUse: lineClaimsAttemptedUse(contextLine),
      seconds: sceneSeconds(contextLine),
    },
    {
      role: "observed",
      narration: observedLine,
      visual: { kind: "kinetic-text", screenshotId: null, label: frame.topic, illustrative: false },
      claimsAttemptedUse: lineClaimsAttemptedUse(observedLine),
      seconds: sceneSeconds(observedLine),
    },
    {
      role: "evidence",
      narration: evidenceLine,
      visual: {
        kind: linkedShotId ? "screenshot" : "kinetic-text",
        screenshotId: linkedShotId,
        label: labelForScreenshot(pkg, linkedShotId),
        illustrative: false,
      },
      claimsAttemptedUse: lineClaimsAttemptedUse(evidenceLine),
      seconds: sceneSeconds(evidenceLine),
    },
    {
      role: "friction",
      narration: frictionLine,
      visual: {
        kind: linkedShotId ? "screenshot" : "kinetic-text",
        screenshotId: linkedShotId,
        label: labelForScreenshot(pkg, linkedShotId),
        illustrative: false,
      },
      claimsAttemptedUse: lineClaimsAttemptedUse(frictionLine),
      seconds: sceneSeconds(frictionLine),
    },
    {
      role: "repair",
      narration: repairLine,
      visual: { kind: "repair-concept", screenshotId: null, label: "What we'd change", illustrative: true },
      claimsAttemptedUse: lineClaimsAttemptedUse(repairLine),
      seconds: sceneSeconds(repairLine),
    },
    {
      role: "handoff",
      narration: handoffLine,
      visual: { kind: "kinetic-text", screenshotId: null, label: short, illustrative: false },
      claimsAttemptedUse: lineClaimsAttemptedUse(handoffLine),
      seconds: sceneSeconds(handoffLine),
    },
  ];

  const narrationScript = scenes.map((s) => s.narration).join(" ");
  const estimatedSeconds = Math.round(scenes.reduce((n, s) => n + s.seconds, 0) * 10) / 10;

  // Attempted-use honesty: any "I/we tried to …" line is allowed ONLY when the frame
  // supports an attempted action. This is the truth gate Breakbot also enforces.
  const anyAttemptClaim = scenes.some((s) => s.claimsAttemptedUse);
  const attemptedUseHonest = !anyAttemptClaim || frame.attemptSupported;

  return {
    offerId: offer.offerId,
    company: pkg.company,
    frameVersion: frame.version,
    narrationVersion: PV_NARRATION_VERSION,
    buildable: true,
    blockedReason: null,
    scenes,
    narrationScript,
    estimatedSeconds,
    attemptedUseHonest,
  };
}

// ── Digests + idempotency ────────────────────────────────────────────────────
function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** The evidence digest the video binds to (identical basis as every other asset). */
export function sourceEvidenceDigestFor(pkg: EvidencePackage): string {
  return evidenceVersion(pkg);
}

/** Deterministic hash of the authoritative narration script. */
export function narrationDigestFor(storyboard: VideoStoryboard): string {
  return `nar1_${sha16(`${storyboard.narrationVersion}|${storyboard.narrationScript}`)}`;
}

/**
 * The idempotency key for a render: identical inputs → identical key → reuse the
 * existing asset instead of re-rendering. Encodes everything that changes pixels or
 * words. An operator refresh must NOT change this.
 */
export function personalizedVideoIdempotencyKey(args: {
  offerId: string;
  offerVersion: string;
  evidenceDigest: string;
  narrationVersion: string;
  renderVersion: string;
}): string {
  return [
    "personalized-video",
    args.offerId,
    args.offerVersion,
    args.evidenceDigest,
    args.narrationVersion,
    args.renderVersion,
  ].join(":");
}

// ── Readiness / staleness judgement ──────────────────────────────────────────
export interface PersonalizedVideoCurrentInputs {
  offerVersion: string;
  evidenceVersion: string;
  narrationVersion: string;
  renderVersion: string;
}

/**
 * Judge the effective status of a stored record against the CURRENT inputs. Never
 * upgrades: a record that claims READY but was rendered against stale evidence /
 * narration / render, or is not playable, degrades to STALE (or the honest lower
 * state). A missing record is NOT_GENERATED. This is the single source consulted by
 * evidence-package + Breakbot.
 */
export function personalizedVideoReadiness(
  record: PersonalizedDiagnosticVideoRecord | null | undefined,
  current: PersonalizedVideoCurrentInputs,
): PersonalizedVideoStatus {
  if (!record) return "NOT_GENERATED";

  // Terminal/in-flight states pass through unchanged (they are not "ready" anyway).
  if (record.status === "FAILED") return "FAILED";
  if (record.status === "BLOCKED") return "BLOCKED";
  if (record.status === "QUEUED") return "QUEUED";
  if (record.status === "RENDERING") return "RENDERING";
  if (record.status === "NOT_GENERATED") return "NOT_GENERATED";

  // status is READY or STALE — verify the bindings still hold.
  const boundToCurrent =
    record.offerVersion === current.offerVersion &&
    record.evidenceVersion === current.evidenceVersion &&
    record.narrationVersion === current.narrationVersion &&
    record.renderVersion === current.renderVersion;

  const playable = !!record.mp4Url && !!record.posterUrl && (record.durationSeconds ?? 0) > 0;

  if (record.status === "READY" && boundToCurrent && playable) return "READY";
  return "STALE";
}

/** Human-readable detail for the current status (for manifests + operator views). */
export function personalizedVideoDetail(status: PersonalizedVideoStatus): string {
  switch (status) {
    case "READY":
      return "A personalized walkthrough of your real website, built from the same review this offer is based on.";
    case "STALE":
      return "A personalized video exists but the review changed underneath it — it needs to be re-rendered before it can be used.";
    case "QUEUED":
      return "A personalized video is queued to render.";
    case "RENDERING":
      return "A personalized video is currently rendering.";
    case "FAILED":
      return "The personalized video render failed and needs to be retried.";
    case "BLOCKED":
      return "A personalized video can't be built yet — there is no evidence-backed finding to walk through.";
    case "NOT_GENERATED":
    default:
      return "A personalized video has not been generated for this offer yet.";
  }
}

// Map the personalized-video status to the evidence-package AssetStatus vocabulary.
// READY→READY, STALE→STALE, everything-not-yet-a-usable-asset→MISSING. The evidence
// package NEVER shows a non-READY personalized video as anything better than MISSING,
// and NEVER substitutes the evergreen.
export function personalizedVideoAssetStatus(status: PersonalizedVideoStatus): AssetStatus {
  if (status === "READY") return "READY";
  if (status === "STALE") return "STALE";
  return "MISSING";
}

/** Build the EvidenceAssetRef the evidence package exposes for the personalized video. */
export function personalizedVideoAssetRef(
  record: PersonalizedDiagnosticVideoRecord | null | undefined,
  current: PersonalizedVideoCurrentInputs,
): EvidenceAssetRef {
  const status = personalizedVideoReadiness(record, current);
  return {
    status: personalizedVideoAssetStatus(status),
    url: status === "READY" ? (record?.mp4Url ?? null) : null,
    detail: personalizedVideoDetail(status),
  };
}

// ── Attempted-use truth check (Breakbot Part E) ──────────────────────────────
export interface NarrationTruthResult {
  ok: boolean;
  reason: string | null;
}

/**
 * Verify a narration script's attempted-use claims against the offer's canonical
 * frame. If the script says "I/we tried to …" but the frame does not support an
 * attempted action, that is a BLOCKER (unsupported attempted-action language). A
 * purely observational script always passes. Pure.
 */
export function assessNarrationTruth(narrationScript: string, offer: QuickFixOffer): NarrationTruthResult {
  const frame: ExperienceFrame = experienceFrameForOffer(offer);
  const claimsAttempt = lineClaimsAttemptedUse(narrationScript);
  if (claimsAttempt && !frame.attemptSupported) {
    return {
      ok: false,
      reason:
        "Narration claims an attempted action ('I/we tried to …') the evidence does not support — use the honest observational frame.",
    };
  }
  return { ok: true, reason: null };
}

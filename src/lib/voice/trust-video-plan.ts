// ─────────────────────────────────────────────────────────────────────────────
// TRUST-VIDEO VOICE PLAN — PURE, read-only preservation logic (no I/O, no ElevenLabs).
//
// POLICY (critical): the existing per-scope trust videos in public/trust-videos/ were
// produced with pre-recorded (Lucas-era) narration. They are LEGACY and are PRESERVED
// as-is: this module NEVER regenerates, deletes, or supersedes any asset. Matt is the
// default voice for NEW journeys only; the Matt trust-video library is built
// INCREMENTALLY and REUSED — never bulk-migrated. There is NO bulk-migration
// authorization anywhere in this file.
//
// Coherence rule (mirrors the voice registry): a journey resolves to exactly ONE
// generation and is never silently mixed. So we:
//   • NEVER return a Lucas asset for a Matt journey (no silent fallback), and
//   • NEVER return a Matt asset for a legacy-lucas journey (no silent mixing).
//
// estimateMattMigration() is an INFORMATIONAL dry-run cost estimate ONLY — it describes
// what a FUTURE incremental, on-demand build WOULD cost. It is not an authorization to
// generate anything and produces no side effects.
// ─────────────────────────────────────────────────────────────────────────────
import type { TrustVideoScope } from "@/lib/quick-fix/trust-videos";
import {
  voiceGeneration,
  DEFAULT_VOICE_KEY,
  type VoiceGeneration,
} from "@/lib/voice/registry";

/**
 * How a scope's trust video relates to the Matt voice generation:
 *  - "matt-available":            a Matt trust video already exists → REUSE it, no generation.
 *  - "legacy-lucas-preserved":    the on-disk asset is legacy Lucas → keep as-is for legacy journeys.
 *  - "matt-preparation-required": a Matt journey needs this scope but no Matt asset exists yet →
 *                                 it would be generated ON DEMAND later (never bulk).
 */
export type TrustVoiceClass =
  | "matt-available"
  | "legacy-lucas-preserved"
  | "matt-preparation-required";

/** A human-readable action that carries the PRESERVATION guarantee (never destructive). */
export type TrustVoiceAction =
  | "reuse-existing-matt"
  | "preserve-legacy-lucas"
  | "prepare-matt-on-demand";

export interface TrustVideoClassification {
  scope: TrustVideoScope;
  class: TrustVoiceClass;
  /** The safe action. It is NEVER "delete", "regenerate", or "supersede". */
  action: TrustVoiceAction;
}

/**
 * Classify a scope's trust video against the (incrementally built) set of scopes that
 * already have a Matt asset. This describes the two independently-true facts about a
 * scope at once:
 *   1. Whether a Matt asset exists for it (→ matt-available, reuse), and
 *   2. That the on-disk asset is legacy Lucas and must be preserved.
 *
 * When a Matt asset exists we report "matt-available" (the reusable Matt asset is the
 * relevant fact for a Matt journey). Otherwise the only existing asset is legacy Lucas,
 * which we report as "legacy-lucas-preserved" — the legacy asset stays exactly as it is.
 * "matt-preparation-required" is reserved for resolveTrustVideoForJourney(), where we
 * know a MATT journey is asking for a scope that has no Matt asset yet.
 *
 * This function NEVER proposes deleting or superseding a legacy asset.
 */
export function classifyTrustVideo(
  scope: TrustVideoScope,
  existingMattTrustVideos: ReadonlySet<TrustVideoScope>,
): TrustVideoClassification {
  if (existingMattTrustVideos.has(scope)) {
    return { scope, class: "matt-available", action: "reuse-existing-matt" };
  }
  // No Matt asset for this scope → the on-disk asset is legacy Lucas, preserved as-is.
  return { scope, class: "legacy-lucas-preserved", action: "preserve-legacy-lucas" };
}

/** A journey that reuses an existing Matt asset for a scope. */
export interface ReuseMattDecision {
  scope: TrustVideoScope;
  generation: "current-matt";
  outcome: "reuse-matt";
  /** True — the Matt asset already exists and is reused; nothing is generated. */
  reuse: true;
}

/** A Matt journey that needs a scope with no Matt asset yet → prepare ON DEMAND (never bulk). */
export interface PrepareMattDecision {
  scope: TrustVideoScope;
  generation: "current-matt";
  outcome: "prepare-matt";
  /** False — no Matt asset exists yet for this scope; it must be prepared on demand later. */
  reuse: false;
}

/** A legacy-lucas journey → the preserved legacy asset is used, never a Matt asset. */
export interface LegacyLucasDecision {
  scope: TrustVideoScope;
  generation: "legacy-lucas";
  outcome: "use-legacy-lucas";
  /** True — the legacy asset already exists and is preserved/reused as-is. */
  reuse: true;
}

export type TrustVideoJourneyDecision =
  | ReuseMattDecision
  | PrepareMattDecision
  | LegacyLucasDecision;

/**
 * Resolve the trust video for a specific journey, honoring the generation-coherence rule.
 *
 * The journey's generation is derived from its voice key via the voice registry:
 *   • A MATT (current-matt) journey:
 *       - if a Matt asset exists for the scope → REUSE it ("reuse-matt").
 *       - else → "prepare-matt" (generate on demand LATER; never a Lucas fallback, never bulk).
 *   • A LEGACY-LUCAS journey → the preserved legacy asset ("use-legacy-lucas"); never a Matt asset.
 *
 * An unknown/unmapped voice key is treated as the canonical default (Matt), matching the
 * registry's journey normalization — it can therefore never resolve to a Lucas asset.
 *
 * This function NEVER returns a Lucas asset for a Matt journey (no silent fallback) and
 * NEVER returns a Matt asset for a legacy-lucas journey (no silent mixing).
 */
export function resolveTrustVideoForJourney(
  scope: TrustVideoScope,
  journeyVoiceKey: string,
  existingMattTrustVideos: ReadonlySet<TrustVideoScope>,
): TrustVideoJourneyDecision {
  const generation: VoiceGeneration = voiceGeneration(journeyVoiceKey)
    // Unknown key → treat as the canonical default (Matt), never as legacy Lucas.
    ?? (voiceGeneration(DEFAULT_VOICE_KEY) as VoiceGeneration);

  if (generation === "legacy-lucas") {
    // Legacy journey: preserve and reuse the legacy Lucas asset. Never a Matt asset.
    return { scope, generation: "legacy-lucas", outcome: "use-legacy-lucas", reuse: true };
  }

  // current-matt journey.
  if (existingMattTrustVideos.has(scope)) {
    return { scope, generation: "current-matt", outcome: "reuse-matt", reuse: true };
  }
  // No Matt asset yet — prepare on demand later. NOT a Lucas fallback.
  return { scope, generation: "current-matt", outcome: "prepare-matt", reuse: false };
}

// Words per minute assumed for the informational narration-time estimate. The rendered
// trust videos run ~67–83s for ~150-word scripts, i.e. roughly conversational pace.
export const ESTIMATE_WORDS_PER_MINUTE = 150;

export interface MattMigrationEstimate {
  /** Total trust videos considered (one per scope). */
  totalTrustVideos: number;
  /** Scopes that ALREADY have a compatible Matt asset (reuse; no generation). */
  alreadyCompatibleMatt: number;
  /** Scopes whose on-disk asset is legacy Lucas and is PRESERVED as-is. */
  legacyPreserved: number;
  /** Scopes that WOULD require Matt generation IF the library were built incrementally. */
  wouldRequireGeneration: number;
  /** Estimated total narration minutes for the would-require-generation scopes only. */
  estimatedNarrationMinutes: number;
  /** Estimated ElevenLabs requests (one per scope that would require generation). */
  estimatedRequests: number;
}

/**
 * INFORMATIONAL dry-run estimate of what a FUTURE incremental, on-demand Matt build WOULD
 * cost. This performs NO generation, contacts NO provider, and is NOT an authorization.
 *
 * Every scope with no existing Matt asset counts as legacy-preserved AND as
 * would-require-generation: the legacy asset stays, and a Matt asset would only ever be
 * added later, on demand, for a Matt journey that needs it.
 */
export function estimateMattMigration(
  scopes: readonly TrustVideoScope[],
  avgNarrationWords: number,
  existingMattTrustVideos: ReadonlySet<TrustVideoScope> = new Set<TrustVideoScope>(),
): MattMigrationEstimate {
  const totalTrustVideos = scopes.length;
  let alreadyCompatibleMatt = 0;
  let wouldRequireGeneration = 0;

  for (const scope of scopes) {
    if (existingMattTrustVideos.has(scope)) alreadyCompatibleMatt += 1;
    else wouldRequireGeneration += 1;
  }

  // Legacy assets are preserved for every scope that has no Matt asset yet.
  const legacyPreserved = wouldRequireGeneration;

  const words = Math.max(0, avgNarrationWords);
  const minutesEach = words / ESTIMATE_WORDS_PER_MINUTE;
  const estimatedNarrationMinutes =
    Math.round(minutesEach * wouldRequireGeneration * 100) / 100;
  // One on-demand ElevenLabs request per scope that would require generation.
  const estimatedRequests = wouldRequireGeneration;

  return {
    totalTrustVideos,
    alreadyCompatibleMatt,
    legacyPreserved,
    wouldRequireGeneration,
    estimatedNarrationMinutes,
    estimatedRequests,
  };
}

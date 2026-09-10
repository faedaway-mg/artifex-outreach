// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY-AWARE TRUST VIDEO RESOLUTION. Ties the offer's scope + the lead's canonical
// journey voice + the incrementally-built Matt trust library together, honoring the
// generation-coherence rule:
//   • LEGACY-LUCAS journey → the preserved legacy Lucas asset (public/trust-videos/…).
//     NEVER a Matt asset. No ElevenLabs.
//   • CURRENT-MATT journey → the durable Matt trust video for the scope if it exists
//     (REUSE, no generation), else "prepare-matt": script-only, NEVER a Lucas fallback,
//     and Breakbot BLOCKS approval until the Matt trust video is built (mattTrustMissing).
// This module reads stores; it performs no render and no ElevenLabs call.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import {
  scopeForOffer,
  trustVideoForOffer,
  trustVideoScript,
  type TrustVideoScope,
} from "./trust-videos";
import { getLeadVoiceKey } from "../voice/store";
import { voiceGeneration, DEFAULT_VOICE_KEY, type VoiceGeneration } from "../voice/registry";
import { resolveTrustVideoForJourney } from "../voice/trust-video-plan";
import { getMattTrustVideo, mattTrustScopeSet } from "../voice/matt-trust-store";

export interface ResolvedJourneyTrustVideo {
  scope: TrustVideoScope;
  /** The journey's voice generation (matt | lucas). */
  generation: VoiceGeneration;
  outcome: "use-legacy-lucas" | "reuse-matt" | "prepare-matt";
  /** Served asset URLs (video when available; null for prepare-matt → script-only). */
  assetUrl: string | null;
  posterUrl: string | null;
  captionsUrl: string | null;
  captionsVerified: boolean;
  title: string;
  durationSeconds: number | null;
  script: string;
  /** True ONLY for a Matt journey whose scope has no Matt trust video yet — Breakbot blocks. */
  mattTrustMissing: boolean;
  /** Media-format contract: the offer/trust explainer must be LANDSCAPE. Null when no asset is bound. */
  orientation: "landscape" | "portrait" | null;
}

/**
 * Resolve the coherent trust video for an offer's journey. `leadVoiceKey` may be passed
 * (already resolved) or omitted to look it up from the lead's canonical voice.
 */
export async function resolveJourneyTrustVideo(
  offer: Pick<QuickFixOffer, "capabilityKeys" | "leadId">,
  leadVoiceKey?: string,
): Promise<ResolvedJourneyTrustVideo> {
  const scope = scopeForOffer(offer);
  const script = trustVideoScript(scope);
  const voiceKey = leadVoiceKey ?? (await getLeadVoiceKey(offer.leadId));
  const generation: VoiceGeneration = voiceGeneration(voiceKey) ?? (voiceGeneration(DEFAULT_VOICE_KEY) as VoiceGeneration);

  const decision = resolveTrustVideoForJourney(scope, voiceKey, await mattTrustScopeSet());

  if (decision.outcome === "use-legacy-lucas") {
    // Legacy journey → preserved legacy Lucas asset, exactly as-is. No ElevenLabs.
    const legacy = trustVideoForOffer(offer);
    return {
      scope,
      generation: "legacy-lucas",
      outcome: "use-legacy-lucas",
      assetUrl: legacy.asset.assetUrl,
      posterUrl: legacy.asset.posterUrl,
      captionsUrl: legacy.asset.captionsUrl,
      captionsVerified: legacy.asset.captionsVerified,
      title: legacy.asset.title,
      durationSeconds: legacy.asset.durationSeconds,
      script,
      mattTrustMissing: false,
      orientation: legacy.asset.assetUrl ? "landscape" : null, // legacy explainers are landscape
    };
  }

  if (decision.outcome === "reuse-matt") {
    const matt = await getMattTrustVideo(scope);
    if (matt && matt.mp4Key) {
      // REUSE the durable Matt trust video — never counts as a new generation.
      return {
        scope,
        generation: "current-matt",
        outcome: "reuse-matt",
        assetUrl: matt.mp4Url,
        posterUrl: matt.posterUrl,
        captionsUrl: matt.captionsVerified ? matt.captionsUrl : null,
        captionsVerified: matt.captionsVerified,
        title: legacyTitle(scope),
        durationSeconds: matt.durationSeconds,
        script,
        mattTrustMissing: false,
        orientation: matt.orientation ?? "landscape", // trust explainer contract → landscape
      };
    }
    // Set claims reuse but the record vanished — treat as prepare-matt (coherent, blocks).
  }

  // prepare-matt: a Matt journey needs this scope but no Matt asset exists yet. Script-only,
  // NEVER a Lucas fallback. Breakbot blocks approval until the Matt trust video is built.
  return {
    scope,
    generation: "current-matt",
    outcome: "prepare-matt",
    assetUrl: null,
    posterUrl: null,
    captionsUrl: null,
    captionsVerified: false,
    title: legacyTitle(scope),
    durationSeconds: null,
    script,
    mattTrustMissing: true,
    orientation: null,
  };
}

/**
 * Shape the journey-coherent trust video as the offer page's EvergreenAssetVersion view
 * so the existing OfferPageView renders it unchanged. A Matt journey gets the Matt trust
 * video (or script-only when not yet built — NEVER a Lucas video); a Lucas journey gets
 * the preserved legacy Lucas asset. No silent cross-generation mixing ever crosses here.
 */
export async function journeyTrustAsEvergreen(
  offer: Pick<QuickFixOffer, "capabilityKeys" | "leadId">,
  leadVoiceKey?: string,
): Promise<{
  role: "ARTIFEX_QUICK_FIX_EXPLAINER"; variant: "GENERAL_QUICK_FIX"; version: number;
  assetUrl: string | null; posterUrl: string | null; captionsUrl: string | null; captionsVerified: boolean; title: string;
  durationSeconds: number | null; script: string; status: "active"; createdAt: string; updatedAt: string;
  generation: VoiceGeneration; mattTrustMissing: boolean;
}> {
  const r = await resolveJourneyTrustVideo(offer, leadVoiceKey);
  return {
    role: "ARTIFEX_QUICK_FIX_EXPLAINER", variant: "GENERAL_QUICK_FIX", version: r.generation === "current-matt" ? 3 : 2,
    assetUrl: r.assetUrl, posterUrl: r.posterUrl, captionsUrl: r.captionsUrl, captionsVerified: r.captionsVerified,
    title: r.title, durationSeconds: r.durationSeconds, script: r.script,
    status: "active", createdAt: "", updatedAt: "", generation: r.generation, mattTrustMissing: r.mattTrustMissing,
  };
}

// The human title for a scope (shared with the legacy asset catalog).
function legacyTitle(scope: TrustVideoScope): string {
  return trustVideoForOffer({ capabilityKeys: [scopeKeyHint(scope)] }).asset.title;
}
// A capability-key hint that maps back to a scope for the title lookup (title only).
function scopeKeyHint(scope: TrustVideoScope): string {
  const hints: Partial<Record<TrustVideoScope, string>> = {
    "contact-form-lead-capture": "contact-form-repair",
    "cta-conversion": "cta-repair",
    "mobile-responsive": "mobile-layout-fix",
    accessibility: "accessibility-quickfix",
    "analytics-tracking": "analytics-install",
    "seo-metadata": "metadata-seo-cleanup",
    "homepage-sprint": "homepage-conversion-sprint",
  };
  return hints[scope] ?? "";
}

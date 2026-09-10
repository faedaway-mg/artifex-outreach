// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX EXPLAINER LIBRARY — the required-scope registry + canonical resolution.
//
// ONE source of truth for "which explainers must exist and what is bound for each".
// Consumed by:
//   • the Breakbot release orchestrator (§9 explainer-library audit — probes the local
//     visual masters offline in the deploy gate);
//   • the Explainer QA Gallery at /launch/explainers (§30 — resolves the ACTUAL bound
//     canonical per scope at runtime and shows MISSING/BLOCKED/etc.).
//
// The SAME canonical resolver the offer readiness uses (Matt bound record → legacy Lucas
// asset → MISSING) so the gallery can never disagree with what a customer would actually
// see on the offer page.
// ─────────────────────────────────────────────────────────────────────────────
import { TRUST_VIDEO_ASSETS, type TrustVideoScope } from "./trust-videos";
import { getMattTrustVideo, type MattTrustVideoRecord } from "../voice/matt-trust-store";

// Every explainer scope that MUST have a canonical asset (the 9 offer/trust scopes).
// "general" is the generic fallback narration, not a required standalone explainer.
export const REQUIRED_EXPLAINER_SCOPES: TrustVideoScope[] = [
  "contact-form-lead-capture",
  "cta-conversion",
  "mobile-responsive",
  "accessibility",
  "analytics-tracking",
  "cms-technical",
  "seo-metadata",
  "homepage-sprint",
  "fix-scan",
];

// Format contract: every offer/trust explainer is LANDSCAPE 16:9 (§8).
export const EXPLAINER_ORIENTATION = "landscape" as const;

/** The on-disk local visual master for a scope (the deploy gate probes this offline). */
export function explainerLocalMasterPath(scope: TrustVideoScope): string | null {
  const asset = TRUST_VIDEO_ASSETS[scope];
  if (!asset?.assetUrl) return null;
  // assetUrl is "/trust-videos/{scope}-v{n}.mp4" → local file lives under public/.
  return `public${asset.assetUrl}`;
}

export type ExplainerVoice = "matt" | "lucas" | null;
export type ExplainerSourceKind = "matt-bound" | "legacy-lucas" | "missing";

export interface ResolvedExplainer {
  scope: TrustVideoScope;
  title: string;
  source: ExplainerSourceKind;
  voice: ExplainerVoice;
  /** App-managed served URL the customer/gallery plays (never a raw storage URL). */
  servedMp4Url: string | null;
  posterUrl: string | null;
  captionsUrl: string | null;
  captionsVerified: boolean;
  orientation: "landscape" | "portrait" | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  audioSeconds: number | null;
  /** Visual-master lineage (recovery amendment) when the Matt asset reused one. */
  visualMaster: string | null;
  /** The canonical voiceover this render was muxed against (reuse lineage). */
  voiceoverId: string | null;
  /** A revision key that CHANGES when the underlying asset changes — human review resets on it. */
  assetRevision: string | null;
  updatedAt: string | null;
}

/**
 * Resolve the canonical explainer bound for a scope — the SAME precedence the offer
 * page uses: a durable bound Matt record wins; else the legacy Lucas asset; else MISSING.
 */
export async function resolveCanonicalExplainer(scope: TrustVideoScope): Promise<ResolvedExplainer> {
  const asset = TRUST_VIDEO_ASSETS[scope];
  const title = asset?.title ?? scope;

  const matt: MattTrustVideoRecord | null = await getMattTrustVideo(scope).catch(() => null);
  if (matt?.mp4Key) {
    return {
      scope,
      title,
      source: "matt-bound",
      voice: "matt",
      servedMp4Url: matt.mp4Url,
      posterUrl: matt.posterUrl,
      captionsUrl: matt.captionsVerified ? matt.captionsUrl : null,
      captionsVerified: !!matt.captionsVerified,
      orientation: matt.orientation ?? "landscape",
      width: matt.width ?? null,
      height: matt.height ?? null,
      durationSeconds: matt.durationSeconds ?? null,
      audioSeconds: matt.audioSeconds ?? null,
      visualMaster: matt.visualMaster ?? null,
      voiceoverId: matt.voiceoverId ?? null,
      // Revision = the bound key + updatedAt; changing the asset changes this → review resets.
      assetRevision: `matt:${matt.mp4Key}:${matt.updatedAt}`,
      updatedAt: matt.updatedAt ?? null,
    };
  }

  if (asset?.assetUrl) {
    return {
      scope,
      title,
      source: "legacy-lucas",
      voice: "lucas",
      servedMp4Url: asset.assetUrl,
      posterUrl: asset.posterUrl,
      captionsUrl: asset.captionsVerified ? asset.captionsUrl : null,
      captionsVerified: asset.captionsVerified,
      orientation: "landscape",
      width: null,
      height: null,
      durationSeconds: asset.durationSeconds ?? null,
      audioSeconds: null,
      visualMaster: `${scope}-v${asset.version}`,
      voiceoverId: null,
      assetRevision: `lucas:${asset.assetUrl}:v${asset.version}`,
      updatedAt: null,
    };
  }

  return {
    scope,
    title,
    source: "missing",
    voice: null,
    servedMp4Url: null,
    posterUrl: null,
    captionsUrl: null,
    captionsVerified: false,
    orientation: null,
    width: null,
    height: null,
    durationSeconds: null,
    audioSeconds: null,
    visualMaster: null,
    voiceoverId: null,
    assetRevision: null,
    updatedAt: null,
  };
}

/** Resolve every required explainer (MISSING scopes are RETAINED, never dropped — §9). */
export async function resolveExplainerLibrary(): Promise<ResolvedExplainer[]> {
  return Promise.all(REQUIRED_EXPLAINER_SCOPES.map((s) => resolveCanonicalExplainer(s)));
}

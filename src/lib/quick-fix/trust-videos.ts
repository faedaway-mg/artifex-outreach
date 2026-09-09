// ─────────────────────────────────────────────────────────────────────────────
// QUICK-FIX EVERGREEN TRUST-VIDEO FAMILY — scope-aware, server-owned selection.
//
// One evergreen family: the opening/process/trust language is shared; the middle
// changes by the offer's actual scope. Videos are rendered assets served from
// /trust-videos/… (see scripts/quickfix-trust-video-render.mjs). The SERVER maps an
// APPROVED SKU → catalog family → active video; the browser can never choose the
// asset. Unknown/unmapped → a safe general fallback (script-only if no asset).
//
// CLAIM SAFETY: these scripts describe only the process — no traffic/revenue/rank/
// outcome/testimonial claims. Verified by test against containsFabricatedClaim.
// ─────────────────────────────────────────────────────────────────────────────
import type { QuickFixOffer } from "./types";
import { FIX_SCAN_SKU } from "./fix-scan";

export type TrustVideoScope =
  | "contact-form-lead-capture" | "cta-conversion" | "mobile-responsive" | "accessibility"
  | "analytics-tracking" | "cms-technical" | "seo-metadata" | "homepage-sprint" | "fix-scan" | "general";

// ── Shared narrative + per-scope module (spoken text; also the caption source) ──
const OPEN =
  "Hey, I'm Jordan with Artifex Labs. We built Quick-Fix for businesses that don't need a giant redesign, a long consulting engagement, or weeks of back-and-forth just to solve one specific problem.";
const CLOSE =
  "The process is straightforward. Once you move forward, we confirm exactly what needs to be fixed, collect only the access or information required to do the work, make the change, test it, and give you clear confirmation of what was completed. We keep the scope intentionally tight. You'll know what you're paying for before the work starts, and if we discover something outside that scope, we don't quietly turn it into a bigger project. We explain it and let you decide what happens next. The goal of Quick-Fix is simple: identify a real problem, fix it properly, and get you back to business without making the process more complicated than it needs to be. That's Artifex Quick-Fix.";

const MODULES: Record<TrustVideoScope, string> = {
  "contact-form-lead-capture": "For this Quick-Fix, we're focused specifically on the part of your site that turns visitors into inquiries. That might mean repairing a contact form, fixing a broken submission flow, correcting where leads are being sent, or making sure the path from the call-to-action to the actual submission works end to end.",
  "cta-conversion": "For this Quick-Fix, we're focused on a specific conversion issue — the part of the experience that should move a visitor toward taking action. We'll address the identified friction, make the necessary change, and test the path so the intended action works clearly and consistently.",
  "mobile-responsive": "For this Quick-Fix, we're focused on the way the experience behaves across screen sizes. We'll correct the identified mobile or responsive issue, verify the important content and actions remain usable, and test the result across the relevant breakpoints.",
  "accessibility": "For this Quick-Fix, we're focused on a specific accessibility issue that can make the site harder to use for some visitors. We'll remediate the defined problem, test the affected experience, and document what was corrected.",
  "analytics-tracking": "For this Quick-Fix, we're focused on making sure the activity you care about can actually be measured. We'll repair or configure the defined tracking, verify that the expected events are being captured, and clearly document what is now being measured.",
  "cms-technical": "For this Quick-Fix, we're focused on a specific technical issue inside the site or CMS. We'll isolate the problem, make the scoped correction, test the affected functionality, and confirm that the repair is working as intended.",
  "seo-metadata": "For this Quick-Fix, we're focused on a defined technical search-visibility issue — things like page metadata, indexing-related configuration, or other scoped on-page technical problems. We'll correct the identified issue and verify that the implementation is properly in place.",
  "homepage-sprint": "For this scope, we're addressing a slightly broader set of issues on one high-value part of the site. We'll focus on the elements most directly affecting clarity, trust, and conversion, make the agreed improvements, and test the resulting experience as one contained sprint.",
  "fix-scan": "This one works a little differently. The Fix Scan is designed for situations where there appears to be a problem, but the correct repair isn't clear enough yet to responsibly sell you a solution. We inspect the issue, identify what is actually happening, and give you a clear recommended next step. If you move forward with an eligible repair afterward, the Fix Scan can be credited according to the terms of the offer.",
  "general": "For each Quick-Fix, we focus on one clearly defined issue. We agree on the scope before work begins, make the required correction, test the result, and show you what was completed.",
};

/** The full spoken script for a scope (opening + scope module + close). */
export function trustVideoScript(scope: TrustVideoScope): string {
  return `${OPEN} ${MODULES[scope]} ${CLOSE}`;
}

export const TRUST_VIDEO_SCRIPT_VERSION = "qf-trust-v1-2026-09";

// ── Rendered assets (source of truth for the app). Active = QA-passed + served. ──
export interface TrustVideoAsset {
  scope: TrustVideoScope;
  title: string;
  assetUrl: string | null;   // null → no video; offer page shows the script text
  posterUrl: string | null;
  version: number;
  scriptVersion: string;
  durationSeconds: number | null;
  active: boolean;
}

const V = 1;
function asset(scope: Exclude<TrustVideoScope, "general">, title: string, durationSeconds: number): TrustVideoAsset {
  return { scope, title, assetUrl: `/trust-videos/${scope}-v${V}.mp4`, posterUrl: `/trust-videos/${scope}-v${V}-poster.jpg`, version: V, scriptVersion: TRUST_VIDEO_SCRIPT_VERSION, durationSeconds, active: true };
}

export const TRUST_VIDEO_ASSETS: Record<TrustVideoScope, TrustVideoAsset> = {
  "contact-form-lead-capture": asset("contact-form-lead-capture", "Contact Form & Lead Capture", 70.5),
  "cta-conversion": asset("cta-conversion", "CTA & Conversion", 70.9),
  "mobile-responsive": asset("mobile-responsive", "Mobile & Responsive Layout", 72.4),
  "accessibility": asset("accessibility", "Accessibility", 66.9),
  "analytics-tracking": asset("analytics-tracking", "Analytics & Tracking", 67.3),
  "cms-technical": asset("cms-technical", "CMS & Technical", 70.0),
  "seo-metadata": asset("seo-metadata", "SEO & Metadata", 71.4),
  "homepage-sprint": asset("homepage-sprint", "Homepage Conversion Sprint", 67.8),
  "fix-scan": asset("fix-scan", "Fix Scan", 84.7),
  // General is the safe fallback — script-only (no rendered asset), never preferred.
  general: { scope: "general", title: "Artifex Quick-Fix", assetUrl: null, posterUrl: null, version: V, scriptVersion: TRUST_VIDEO_SCRIPT_VERSION, durationSeconds: null, active: true },
};

// ── SKU (capability key) → scope. The server owns this map. ─────────────────────
export const SKU_SCOPE: Record<string, TrustVideoScope> = {
  "contact-form-repair": "contact-form-lead-capture",
  "lead-capture-package": "contact-form-lead-capture",
  "cta-repair": "cta-conversion",
  "trust-signal-install": "cta-conversion",
  "mobile-layout-fix": "mobile-responsive",
  "accessibility-quickfix": "accessibility",
  "analytics-install": "analytics-tracking",
  "metadata-seo-cleanup": "seo-metadata",
  "homepage-conversion-sprint": "homepage-sprint",
  [FIX_SCAN_SKU.key]: "fix-scan",
};

/** Scope for a capability/SKU key. Unknown → general (safe fallback). */
export function scopeForSku(capKey: string | undefined | null): TrustVideoScope {
  return (capKey && SKU_SCOPE[capKey]) || "general";
}

/** Scope for an offer — from its primary bundled capability. */
export function scopeForOffer(offer: Pick<QuickFixOffer, "capabilityKeys">): TrustVideoScope {
  return scopeForSku(offer.capabilityKeys?.[0]);
}

/** The ACTIVE asset for a scope. Falls back to general when a scope has no active
 *  asset. Only active assets are ever returned. Server-owned; no client override. */
export function selectTrustVideo(scope: TrustVideoScope): TrustVideoAsset {
  const a = TRUST_VIDEO_ASSETS[scope];
  if (a && a.active) return a;
  return TRUST_VIDEO_ASSETS.general;
}

export interface ResolvedTrustVideo { scope: TrustVideoScope; asset: TrustVideoAsset; script: string }

/** Deterministic resolution for an offer: SKU → scope → active asset → fallback. */
export function trustVideoForOffer(offer: Pick<QuickFixOffer, "capabilityKeys">): ResolvedTrustVideo {
  const scope = scopeForOffer(offer);
  const asset = selectTrustVideo(scope);
  return { scope, asset, script: trustVideoScript(asset.scope) };
}

/** Shape the resolved trust video as the offer-page's EvergreenAssetVersion view so
 *  the existing OfferPageView renders it unchanged (video when present, else script). */
export function trustVideoAsEvergreen(offer: Pick<QuickFixOffer, "capabilityKeys">): {
  role: "ARTIFEX_QUICK_FIX_EXPLAINER"; variant: "GENERAL_QUICK_FIX"; version: number;
  assetUrl: string | null; durationSeconds: number | null; script: string; status: "active";
  createdAt: string; updatedAt: string;
} {
  const r = trustVideoForOffer(offer);
  return {
    role: "ARTIFEX_QUICK_FIX_EXPLAINER", variant: "GENERAL_QUICK_FIX", version: r.asset.version,
    assetUrl: r.asset.assetUrl, durationSeconds: r.asset.durationSeconds, script: r.script,
    status: "active", createdAt: "", updatedAt: "",
  };
}

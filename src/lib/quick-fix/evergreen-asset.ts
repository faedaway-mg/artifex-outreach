// ─────────────────────────────────────────────────────────────────────────────
// EVERGREEN TRUST VIDEO — the ARTIFEX_QUICK_FIX_EXPLAINER.
//
// A SINGLE reusable, versioned, widescreen asset shown on EVERY offer page. It is
// NOT personalized and NOT regenerated per lead. Offer pages pull the currently
// active approved version, so swapping the trust video never regenerates a single
// offer. Architecture supports future variants (WEBSITE_FIX, AUTOMATION_FIX, …)
// but we ship exactly one GENERAL_QUICK_FIX to avoid premature complexity.
// ─────────────────────────────────────────────────────────────────────────────

export type EvergreenAssetRole = "ARTIFEX_QUICK_FIX_EXPLAINER";
export type EvergreenVariant = "GENERAL_QUICK_FIX" | "WEBSITE_FIX" | "AUTOMATION_FIX" | "ACCESSIBILITY_FIX";

export type EvergreenStatus = "draft" | "active" | "retired";

export interface EvergreenAssetVersion {
  role: EvergreenAssetRole;
  variant: EvergreenVariant;
  version: number;
  assetUrl: string | null; // null until a render is uploaded/attached
  durationSeconds: number | null;
  /** The approved narration script (illustrative until an operator finalizes). */
  script: string;
  status: EvergreenStatus;
  createdAt: string;
  updatedAt: string;
}

// The canonical, operationally-true explainer script (60–120s). No guarantees,
// no fake testimonials, no unverifiable claims — only how the process works.
export const CANONICAL_EXPLAINER_SCRIPT = [
  "Hey, I'm Jordan with Artifex Labs.",
  "If you're on this page, we've identified a specific improvement we believe we can help with.",
  "The idea behind these offers is simple. Instead of a long sales process or a large project, we scope one specific problem, give you a flat price, and clearly explain what we need to complete it.",
  "Once you purchase, you'll get a secure checklist showing anything required from you — like website access, an account invitation, or an approval.",
  "Once we receive everything required to begin, the turnaround shown on your offer starts.",
  "The price shown covers the scope shown. If we discover something outside that scope, we'll tell you before doing additional work.",
  "If everything here looks good, you can continue below and get your fix started.",
].join(" ");

/** The seed version — status draft until an operator attaches a render + activates. */
export function seedEvergreenExplainer(now: string): EvergreenAssetVersion {
  return {
    role: "ARTIFEX_QUICK_FIX_EXPLAINER",
    variant: "GENERAL_QUICK_FIX",
    version: 1,
    assetUrl: null,
    durationSeconds: null,
    script: CANONICAL_EXPLAINER_SCRIPT,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Select the active evergreen video for an offer page. Prefers an active version
 * of the matching variant, then an active GENERAL_QUICK_FIX, else the latest
 * draft (so pages still render the script while the render is being produced).
 */
export function selectActiveEvergreen(
  versions: EvergreenAssetVersion[],
  variant: EvergreenVariant = "GENERAL_QUICK_FIX",
): EvergreenAssetVersion | null {
  if (!versions.length) return null;
  const active = versions.filter((v) => v.status === "active");
  const byVariant = active.filter((v) => v.variant === variant).sort((a, b) => b.version - a.version)[0];
  if (byVariant) return byVariant;
  const general = active.filter((v) => v.variant === "GENERAL_QUICK_FIX").sort((a, b) => b.version - a.version)[0];
  if (general) return general;
  return versions.slice().sort((a, b) => b.version - a.version)[0] ?? null;
}

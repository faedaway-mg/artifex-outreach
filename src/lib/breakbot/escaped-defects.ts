// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — ESCAPED-DEFECT REGISTRY (Release Orchestrator mandate §28/§29).
//
// The product rule: the operator is NOT the routine final QA engineer. When a defect
// DID escape to production / user discovery, we do not merely fix it once — we record
// WHY Breakbot missed it and the exact invariant/guard/test that now makes it
// impossible to recur silently. Every escaped defect makes Breakbot permanently
// stronger; this registry is the ledger of that ratchet.
//
// PURE data + a validation function — no I/O. The accompanying test asserts every
// entry names a real covering guard, so a registry entry can never claim coverage
// that doesn't exist. The release orchestrator surfaces this registry in its report
// and the operator UI so the coverage is visible, not folkloric.
// ─────────────────────────────────────────────────────────────────────────────

export type DefectSurface =
  | "offer-page"
  | "trust-explainer"
  | "media-route"
  | "content-studio"
  | "lead-views"
  | "customer-portal"
  | "quick-cash";

export interface EscapedDefect {
  /** Stable id (kebab). */
  id: string;
  /** One-line description of the class of failure, as a customer/operator would see it. */
  defectClass: string;
  /** The customer/operator surface it affected. */
  surface: DefectSurface;
  /** Why the pre-existing Breakbot suite did not catch it (the gap). */
  whyMissed: string;
  /**
   * The guard(s) that now cover it — a module symbol, test name, or invariant key.
   * These are asserted to exist by escaped-defects.test.ts (coverage is not folklore).
   */
  coveredBy: string[];
  /** The release/commit the coverage first shipped in (or "pending-deploy"). */
  firstCovered: string;
}

// The known escaped defects (mandate §29 enumerates these as required permanent
// regressions). Newest classes first. Keep `coveredBy` pointing at real, testable guards.
export const ESCAPED_DEFECTS: EscapedDefect[] = [
  {
    id: "blank-after-opening-explainer",
    defectClass: "A rendered explainer opened correctly then went blank/static for the rest of a ~65s runtime, yet passed 200/duration/first-frame checks.",
    surface: "trust-explainer",
    whyMissed:
      "Media QA only checked that the file existed, returned HTTP 200, had a valid duration, and a good FIRST frame. Nothing inspected representative frames throughout the runtime.",
    coveredBy: [
      "src/lib/breakbot/media-qa.ts:assessMedia",           // dominant-frozen-run + blank-timeline blocker
      "media.blankTimeline",                                  // finding kind
      "media.static",                                         // finding kind
      "src/lib/breakbot/media-qa.test.ts:blank-after-opening", // regression fixture
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "wrong-orientation-explainer",
    defectClass: "A portrait video was bound to a landscape offer/trust explainer contract (or vice-versa) and still played, satisfying the wrong format.",
    surface: "trust-explainer",
    whyMissed: "No check compared the asset's real pixel orientation against the format contract for its scope.",
    coveredBy: [
      "src/lib/breakbot/media-qa.ts:assessMedia",       // orientation blocker
      "media.orientation",                                // finding kind
      "src/lib/breakbot/media-qa.test.ts:media.orientation", // executable regression
      "src/lib/quick-fix/trust-video-resolve.test.ts",   // executable orientation resolve test
    ],
    firstCovered: "6b5aaf8",
  },
  {
    id: "offer-purchasable-without-trust-video",
    defectClass: "The $495 offer CTA stayed live while the required explainer video was missing/not-ready (fail-open checkout).",
    surface: "offer-page",
    whyMissed: "buildOfferPageModel computed purchasable from reasons.length===0 but never required a playable canonical explainer, so a missing/script-only video left checkout live.",
    coveredBy: [
      "src/lib/quick-fix/offer-page.ts:buildOfferPageModel", // trustVideoReady gate
      "src/components/quick-fix/OfferCheckout.tsx",           // HOLD state, no $495 button
      "src/lib/quick-fix/offer-trust-gate.test.ts",           // executable regression
    ],
    firstCovered: "ee60dca",
  },
  {
    id: "transcript-replaces-video",
    defectClass: "A transcript wall was shown in place of the actual explainer video (transcript treated as a substitute for the missing media).",
    surface: "offer-page",
    whyMissed: "Readiness did not distinguish a playable asset from script/transcript text; a script-only 'prepare-matt' state read as ready-enough.",
    coveredBy: [
      "src/lib/quick-fix/offer-page.ts:buildOfferPageModel", // requires evergreen.assetUrl (durable bound asset)
      "src/lib/quick-fix/trust-video-resolve.ts",             // resolves only a durable bound asset
      "src/lib/quick-fix/offer-trust-gate.test.ts",           // executable regression
    ],
    firstCovered: "ee60dca",
  },
  {
    id: "ready-personalized-video-never-surfaces",
    defectClass: "A genuinely-READY personalized diagnostic video never reached the customer: the offer page built the evidence package without the record (never fetched it), and the serve gate demanded the raw share token though the media URL is offerId-keyed — so every customer view showed no video / 404'd.",
    surface: "offer-page",
    whyMissed: "No synthetic prospect ever loaded an offer with a REAL rendered personalized video — the asset was MISSING in prod, so the fetch-omission and the offerId-vs-token gate mismatch stayed dormant until one was generated.",
    coveredBy: [
      "src/lib/quick-fix/evidence-package.ts:getPersonalizedVideo",        // fetch the record when opts omitted
      "src/lib/quick-fix/personalized-video-serve.ts",                     // offerId capability (mirrors offer page)
      "src/lib/quick-fix/personalized-video-surfacing.test.ts",           // executable regression (both fixes)
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "quickcash-approval-reverts-on-refresh",
    defectClass: "An operator lifecycle action on Quick Cash (Prepare & approve → get link) appeared complete, then reverted on refresh/navigation — the card fell back to a needs-approval state as though the action never happened.",
    surface: "quick-cash",
    whyMissed: "The 'done' link state lived only in client component state; nothing asserted that the canonical persisted offer state survives a reload, and the page rebuilt cards from a fresh per-load pass without an autonomous reconcile.",
    coveredBy: [
      "src/lib/quick-fix/store.ts:reconcileQuickCashOffers",              // autonomous idempotent persist+approve
      "src/lib/quick-fix/quick-cash-lifecycle.ts:deriveQuickCashLifecycle", // canonical state from persisted truth
      "src/lib/quick-fix/quick-cash-persistence.test.ts:refresh",        // executable regression: survives repeated reads
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "media-route-login-redirect",
    defectClass: "The customer-facing trust-video / personalized-video media routes 307-redirected to /login, so the video could not play on the public offer page.",
    surface: "media-route",
    whyMissed: "The middleware public allowlist did not include the customer media routes; no synthetic prospect actually fetched the media without a session.",
    coveredBy: [
      "src/middleware.ts",                                   // /api/quick-fix/trust-video/ + personalized-video allowlist
      "src/lib/breakbot/media-route-isolation.test.ts",      // executable regression (allowlist present)
    ],
    firstCovered: "6b5aaf8",
  },
  {
    id: "content-studio-exposes-machinery",
    defectClass: "Content Studio's normal UI exposed obsolete production machinery (narration script editor, Copy Narration, Upload Voiceover, separate Generate-Voiceover/Video).",
    surface: "content-studio",
    whyMissed: "No invariant asserted the zero-touch normal view hides the machinery controls; they were only meant for Advanced/History.",
    coveredBy: [
      "src/lib/content-studio/zero-touch.ts:HIDDEN_MACHINERY_CONTROLS",
      "src/components/content-studio/ZeroTouchStudio.tsx:content-studio-zero-touch", // normal view = brief→Generate
      "src/lib/content-studio/zero-touch-ui.test.ts",                                  // executable regression
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "stale-prospects-in-active-views",
    defectClass: "Stale / unqualified (enterprise/franchise) prospects contaminated active operator views and could ramp-promote.",
    surface: "lead-views",
    whyMissed: "Active-view filtering did not exclude out-of-ICP leads before scoring/promotion.",
    coveredBy: [
      "src/lib/lead-sprint/legacy-active.ts:isActiveLead",
      "src/lib/lead-sprint/legacy-active.test.ts",           // executable regression
    ],
    firstCovered: "3fd3287",
  },
];

export interface RegistryValidation {
  ok: boolean;
  /** Entries whose coveredBy guards were not all found on disk. */
  uncovered: Array<{ id: string; missing: string[] }>;
}

/**
 * Validate the registry against a resolver that reports whether a guard reference
 * exists (a file path, a `path:symbol`, or a bare finding-kind/invariant key). PURE:
 * the caller supplies `guardExists` (the test/harness does the I/O). A registry entry
 * that claims coverage which does not exist fails closed.
 */
export function validateRegistry(guardExists: (ref: string) => boolean): RegistryValidation {
  const uncovered: RegistryValidation["uncovered"] = [];
  for (const d of ESCAPED_DEFECTS) {
    const missing = d.coveredBy.filter((ref) => !guardExists(ref));
    if (missing.length > 0) uncovered.push({ id: d.id, missing });
  }
  return { ok: uncovered.length === 0, uncovered };
}

/** Registry summary for the release report / operator UI. */
export function escapedDefectSummary(): { total: number; bySurface: Record<string, number>; pendingDeploy: number } {
  const bySurface: Record<string, number> = {};
  let pendingDeploy = 0;
  for (const d of ESCAPED_DEFECTS) {
    bySurface[d.surface] = (bySurface[d.surface] ?? 0) + 1;
    if (d.firstCovered === "pending-deploy") pendingDeploy++;
  }
  return { total: ESCAPED_DEFECTS.length, bySurface, pendingDeploy };
}

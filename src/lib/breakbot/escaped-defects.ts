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
  | "quick-cash"
  | "package-integrity"
  | "evergreen-admin";

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
    id: "overview-preview-subject-divergence",
    defectClass: "The Quick Cash Overview showed '— no subject —' while the Preview showed a real SUBJECT for the same package — every operator surface built its own view from divergent fields, so they could disagree.",
    surface: "package-integrity",
    whyMissed: "There was no single canonical package read model; the list read raw offer.scope.problemBeingSolved while Preview derived the subject via the subject engine. Nothing asserted the surfaces render the SAME subject/finding.",
    coveredBy: [
      "src/lib/quick-fix/canonical-package.ts:buildCanonicalPackage",   // ONE story every surface derives from
      "src/lib/quick-fix/package-coherence.ts:subject.missing",          // BLOCKs an empty/generic subject
      "src/lib/quick-fix/package-coherence.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "hero-finding-story-mismatch",
    defectClass: "The offer hero sold one story ('I tried to send an inquiry') while the finding described a different one (brand recall) — one package told two stories.",
    surface: "package-integrity",
    whyMissed: "Copy surfaces were single-sourced but coherence was never enforced; nothing compared the subject/hero defect family against the finding's family.",
    coveredBy: [
      "src/lib/quick-fix/package-coherence.ts:hero.mismatch",
      "src/lib/quick-fix/package-coherence.ts:claim.overstated",
      "src/lib/quick-fix/package-coherence.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "personalized-video-missing-while-no-blockers",
    defectClass: "A package reported 'no blockers' while a required personalized diagnostic video was missing — a paid gap was silently treated as done.",
    surface: "package-integrity",
    whyMissed: "Readiness never separated the paid-media lane; a missing personalized video did not surface as WAITING_FOR_PAID in the completeness chain.",
    coveredBy: [
      "src/lib/quick-fix/package-completeness.ts:waitingForPaidOnly",
      "src/lib/quick-fix/canonical-package.ts:WAITING_FOR_PAID",
      "src/lib/quick-fix/package-completeness.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "weak-finding-becomes-quickfix",
    defectClass: "A concrete-but-immaterial finding ('the business name appears in more than one form, quietly weakens brand recall') became a sellable Quick-Fix instead of being retired.",
    surface: "lead-views",
    whyMissed: "The evidence gate required concreteness + a 0.6 confidence floor but had NO materiality/sellability threshold, so a crawler-describable nit could anchor a paid offer.",
    coveredBy: [
      "src/lib/quick-fix/evidence-gate.ts:isMaterialFinding",
      "src/lib/quick-fix/evidence-materiality.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "retired-inflates-active-inventory",
    defectClass: "Retired / legacy records inflated the number that visually reads as active work (the '67' that were mostly retired).",
    surface: "package-integrity",
    whyMissed: "There was no retire action and no sweep that classified retired out of ACTIVE; counts did not distinguish active from retired/fixtures.",
    coveredBy: [
      "src/lib/quick-fix/store.ts:retireOffer",
      "src/lib/quick-fix/package-qa.ts:packageInventorySweep",
      "src/lib/quick-fix/package-qa.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "forward-only-fix-skips-backfill",
    defectClass: "Package fixes applied only to NEW packages while older active records kept stale/generic generations — the good system never reached existing active leads.",
    surface: "package-integrity",
    whyMissed: "There was no bulk reconciliation that ran current package contracts over the existing active inventory; repair was per-offer + manual.",
    coveredBy: [
      "src/lib/quick-fix/package-repair.ts:repairAllEligible",
      "src/lib/quick-fix/package-repair.ts:completePackage",
      "src/lib/quick-fix/package-repair.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "fixture-passes-while-real-package-incomplete",
    defectClass: "Breakbot passed on golden fixtures while a real active package remained incomplete — QA had no visibility into real inventory and no verdict bound to a package revision.",
    surface: "package-integrity",
    whyMissed: "Breakbot audited only synthetic fixtures + explainer masters; it never swept the real active packages or invalidated a prior PASS when customer-facing material changed.",
    coveredBy: [
      "src/lib/quick-fix/package-qa.ts:runPackageQA",
      "src/lib/quick-fix/store.ts:packageQAStale",           // verdict bound to revision (§33)
      "src/lib/quick-fix/package-qa.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "trust-narration-cut-off",
    defectClass: "The CTA-Conversion explainer's Matt narration cut off before finishing: the mux used -shortest and truncated audio to a shorter visual master, and media QA was blind to it (audio duration was never populated).",
    surface: "trust-explainer",
    whyMissed: "Full-runtime visual QA only proved the visuals stayed alive; nothing compared narration length to video length, and the render pipeline never recorded the audio duration the gate needs.",
    coveredBy: [
      "media.narrationCut",                                   // BLOCKER: video shorter than narration
      "media.audioDurationUnknown",                           // WARNING: cannot verify completeness
      "src/lib/breakbot/media-qa.test.ts",
      "scripts/matt-trust-video-render.ts",                   // renders silent + tail-covers the narration
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "customer-facing-version-label",
    defectClass: "The customer offer page showed an internal version label ('CTA & Conversion · v3'); customers should never see V2/V3/draft identifiers.",
    surface: "offer-page",
    whyMissed: "The offer-page video title concatenated the asset version; no regression asserted the customer never sees a version label.",
    coveredBy: [
      "src/components/quick-fix/OfferPageView.tsx",
      "src/lib/quick-fix/inventory-integrity-regressions.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "evergreen-admin-stale-draft-as-active",
    defectClass: "The evergreen admin showed a stale 'v2 · draft · script only' record and the superseded 'Hey, I'm Jordan' script as though active, disagreeing with what the offer page resolves.",
    surface: "evergreen-admin",
    whyMissed: "The admin surface read the old single-asset EvergreenAssetVersion list instead of the canonical explainer registry the offer page uses.",
    coveredBy: [
      "src/app/(app)/revenue/trust-asset/page.tsx:resolveExplainerLibrary",
      "src/lib/quick-fix/inventory-integrity-regressions.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "social-field-note-alive-but-text-only",
    defectClass: "A Zero-Touch social Field Note was technically alive (not blank) but visually lazy — mostly centered text on the same blue/dark background, a narrated PowerPoint rather than visual storytelling.",
    surface: "content-studio",
    whyMissed: "media-qa only checked 'not blank/static'; nothing asserted scene-composition variety, and the zero-touch template only ever emitted title/statement/brand text cards though a richer beat vocabulary already existed.",
    coveredBy: [
      "src/lib/content-studio/social-richness.ts:assessScenePlanRichness",
      "src/lib/content-studio/social-richness.ts:assessRenderedFrameDiversity",
      "src/lib/content-studio/zero-touch-template.ts:inferStructuredBeats",
      "src/lib/content-studio/social-richness.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "pdf-claims-screenshots-that-are-absent",
    defectClass: "The diagnostic PDF asserted 'these are real screenshots we captured' while the package embedded zero (or insufficient) screenshots — the copy claimed evidence it did not have.",
    surface: "offer-page",
    whyMissed: "The §2 intro was hardcoded to claim captured images regardless of how many were actually embedded; nothing tied the screenshot claim to the real embedded count or singular/plural grammar.",
    coveredBy: [
      "src/lib/quick-fix/diagnostic-pdf.tsx:evidenceIntroFor",         // count-driven truthful copy
      "src/lib/quick-fix/diagnostic-pdf.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "cookie-overlay-obscures-screenshot-evidence",
    defectClass: "Evidence screenshots were captured with a cookie/consent overlay covering the actual page content, so the shot did not demonstrate the stated problem.",
    surface: "content-studio",
    whyMissed: "The capture worker took a raw screenshot after a fixed settle with no attempt to dismiss generic consent/chat chrome before clipping.",
    coveredBy: [
      "scripts/screenshot-worker-loop.mjs:dismissOverlays",
      "src/lib/quick-fix/evidence-plan.ts:buildEvidencePlan",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "mobile-claim-without-mobile-evidence",
    defectClass: "A package whose copy said 'from my phone' / 'mobile' had no mobile screenshot, yet still read as evidence-backed.",
    surface: "package-integrity",
    whyMissed: "Nothing required mobile evidence for a mobile claim; the evidence plan and the coherence gate did not exist.",
    coveredBy: [
      "src/lib/quick-fix/package-coherence.ts:mobile.noEvidence",
      "src/lib/quick-fix/evidence-plan.ts:evidencePlanSatisfied",
      "src/lib/quick-fix/evidence-plan.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "no-full-package-completion-action",
    defectClass: "The operator had to run Generate-screenshots → Generate-email → Generate-PDF → … by hand; there was no single action to bring an incomplete active package to its highest valid state.",
    surface: "package-integrity",
    whyMissed: "No materialization action existed; repair was per-artifact + manual, and incomplete packages surfaced 'Approve Offer' instead of 'Complete Package'.",
    coveredBy: [
      "src/lib/quick-fix/package-repair.ts:completePackage",
      "src/lib/quick-fix/canonical-package.ts:complete-package",       // nextAction kind
      "src/lib/quick-fix/package-repair.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "weak-observation-manufactured-into-offer",
    defectClass: "Acquisition OS turned a weak observation into an offer instead of deciding NO_MATERIAL_PROBLEM — it tried to find a sentence to say about every website rather than a real, demonstrable problem.",
    surface: "lead-views",
    whyMissed: "There was no first-class 'no material problem' outcome and no Problem Reality gate; any concrete-ish finding could anchor an offer.",
    coveredBy: [
      "src/lib/quick-fix/problem-reality.ts:NO_MATERIAL_PROBLEM",
      "src/lib/quick-fix/problem-reality.ts:assessProblemReality",
      "src/lib/quick-fix/problem-reality.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "false-broken-path-not-counter-tested",
    defectClass: "A 'no booking / no contact path' hypothesis survived even though the path actually works (Book Now → postal code → valid flow) — the first crawler pass missed the control and nothing tried to disprove it.",
    surface: "lead-views",
    whyMissed: "Qualification relied on page-text/crawler interpretation and never ran an adversarial counter-test to find a working path before accepting the finding.",
    coveredBy: [
      "src/lib/quick-fix/problem-reality.ts:counterTestPlan",
      "src/lib/quick-fix/problem-reality.ts:DISPROVEN",
      "src/lib/quick-fix/problem-reality.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "out-of-market-lead-in-active-inventory",
    defectClass: "California (and other out-of-market) leads remained in active Quick Cash inventory and consumed attention, though California is outside the approved outbound market strategy.",
    surface: "package-integrity",
    whyMissed: "The geography gate ran in Lead Sprint classification but was never re-applied to stored offers; the canonical package had no market gate.",
    coveredBy: [
      "src/lib/quick-fix/market-gate.ts:assessMarketGate",
      "src/lib/quick-fix/canonical-package.ts:market",
      "src/lib/quick-fix/market-gate.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "package-pass-without-proven-problem",
    defectClass: "A package could read Ready-to-Send / 'no blockers' while the underlying problem was unproven or the required assets were missing — green status coexisting with an unproven problem.",
    surface: "package-integrity",
    whyMissed: "The QA verdict was derived from asset completeness alone; it did not require a PROVEN Problem Reality verdict and did not fail closed when reality was unassessed.",
    coveredBy: [
      "src/lib/quick-fix/package-qa.ts:problemReality",           // PASS requires PROVEN (§33/§46)
      "src/lib/quick-fix/package-qa.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
  {
    id: "generic-web-sales-subject",
    defectClass: "Active packages kept generic web-sales subjects ('website note', 'website inquiry') that instantly read as website-sales spam instead of a natural business-journey subject.",
    surface: "package-integrity",
    whyMissed: "The subject engine emitted 'website X' framing and nothing retired it; the coherence gate only blocked an empty subject.",
    coveredBy: [
      "src/lib/quick-fix/subject-engine.ts:isRetiredSubject",
      "src/lib/quick-fix/package-coherence.ts:subject.missing",
      "src/lib/quick-fix/subject-engine.test.ts",
    ],
    firstCovered: "pending-deploy",
  },
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
    id: "voiceover-write-clobbers-matt-trust",
    defectClass: "Generating a voiceover wiped the recovered Matt trust videos: the voice store overwrote the whole `voice` Settings namespace with its VoiceState projection (leadVoices/voiceovers/config), silently dropping the sibling voice.mattTrustVideos owned by the matt-trust-store — so the first social/prospect generation after a trust recovery HELD every offer (no CTA).",
    surface: "trust-explainer",
    whyMissed: "No test generated a voiceover AFTER a trust video was set and then asserted the trust video survived; the two stores share the `voice` namespace but only one preserved the other's keys.",
    coveredBy: [
      "src/lib/voice/store.ts:rawVoice",                          // mutateVoiceState merges, never clobbers siblings
      "src/lib/voice/matt-trust-preservation.test.ts",           // executable regression (voiceover write preserves trust)
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

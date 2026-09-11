// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — BUSINESS-CONTRACT INVARIANTS (Release Orchestrator §15).
//
// The critical Acquisition OS invariants stated as explicit release assertions, each
// pointing at the guard that enforces it. PURE data + a validation function; the test
// asserts every guard reference resolves (an invariant can never claim enforcement that
// doesn't exist). Surfaced in the Breakbot QA UI so the contract is visible, and consumed
// by the release report as the "business invariants" suite.
// ─────────────────────────────────────────────────────────────────────────────

export interface BusinessInvariant {
  key: string;
  /** The rule, as "<condition> → <required outcome>". */
  rule: string;
  /** Where it is enforced (a module/symbol reference or a fixture key). */
  enforcedBy: string;
}

export const BUSINESS_INVARIANTS: BusinessInvariant[] = [
  { key: "trust-missing-holds-offer", rule: "missing trust video → offer HOLD (no $495 CTA)", enforcedBy: "src/lib/quick-fix/offer-page.ts:buildOfferPageModel" },
  { key: "trust-orientation-holds-offer", rule: "wrong trust orientation → offer HOLD", enforcedBy: "src/lib/breakbot/quickcash-preflight.ts" },
  { key: "evidence-missing-not-ready", rule: "missing evidence → prospect not Ready-to-Send", enforcedBy: "src/lib/breakbot/quickcash-preflight.ts" },
  { key: "delivery-off-no-sends", rule: "delivery OFF → no prospect sends", enforcedBy: "src/lib/comms/prospect-transport.ts" },
  { key: "autosend-off-no-autonomous", rule: "autosend OFF → no autonomous delivery", enforcedBy: "src/lib/comms/prospect-transport.ts" },
  { key: "scope-complication-no-silent-expand", rule: "scope complication → no silent scope expansion (offer scope frozen)", enforcedBy: "src/lib/quick-fix/customer-project.ts" },
  { key: "portal-no-internal-fields", rule: "customer portal → never exposes internal fields", enforcedBy: "src/components/quick-fix/CustomerPortalView.tsx" },
  { key: "content-studio-social-only", rule: "Content Studio → social-only, no prospect production workflow", enforcedBy: "src/lib/content-studio/zero-touch.ts" },
  { key: "prospect-transport-fail-closed", rule: "cold prospect outreach → Google lanes only, never Resend (fail-closed)", enforcedBy: "src/lib/comms/prospect-transport.ts" },
  { key: "legacy-excluded-from-active", rule: "out-of-ICP (enterprise/franchise) → excluded from active views", enforcedBy: "src/lib/lead-sprint/legacy-active.ts:isActiveLead" },

  // ── Voice Capacity Manager (mandate C §18) — executable release checks ──────────
  { key: "capacity-reserve-not-silently-consumed", rule: "social generation crossing the Acquisition reserve → blocked (explicit override only)", enforcedBy: "src/lib/voice/capacity.ts:socialGeneratePolicy" },
  { key: "capacity-reserve-not-negative-without-override", rule: "reserve math cannot go negative without an explicit override", enforcedBy: "src/lib/voice/capacity.ts:crossesReserve" },
  { key: "capacity-no-double-count-reuse", rule: "reused audio counts as zero new spend (never double-counted)", enforcedBy: "src/lib/voice/generate.ts:reused" },
  { key: "capacity-retry-no-double-charge", rule: "a downstream render retry never triggers another ElevenLabs generation", enforcedBy: "src/lib/content-studio/zero-touch-actions.ts:reused" },
  { key: "capacity-reset-preserves-ledger", rule: "monthly reset does not erase historical cost/usage ledger (append-only)", enforcedBy: "src/lib/lead-sprint/cost-ledger-store.ts:appendCostEntry" },
  { key: "capacity-unknown-not-fabricated", rule: "unknown provider allowance is never displayed as a fabricated number", enforcedBy: "src/lib/voice/capacity.ts:quotaUnknown" },
  { key: "capacity-trust-reuse-excluded", rule: "trust-video reuse does not count as new forecast TTS", enforcedBy: "src/lib/voice/capacity.ts:forecastAcquisitionReserve" },
  { key: "capacity-zero-touch-ui-simple", rule: "zero-touch Content Studio UI stays simple (machinery hidden)", enforcedBy: "src/lib/content-studio/zero-touch.ts:HIDDEN_MACHINERY_CONTROLS" },
  { key: "capacity-matt-automatic", rule: "Matt remains the automatic social narrator (no voice selector in the normal flow)", enforcedBy: "src/lib/content-studio/zero-touch.ts:SOCIAL_DEFAULT_VOICE" },

  // ── Content Studio idea-queue (mandate D §23) — executable release checks ────────
  { key: "idea-has-usable-brief", rule: "a system-generated idea carries a usable creative brief before it is Generate-ready", enforcedBy: "src/lib/content-studio/social-ideas.ts:brief" },
  { key: "idea-no-per-card-textarea", rule: "concept cards show an auto-written description, never a per-card creative textarea", enforcedBy: "src/components/content-studio/ZeroTouchStudio.tsx:cs-idea-brief" },
  { key: "idea-no-generate-empty-brief", rule: "video generation cannot begin from an empty/unresolved brief", enforcedBy: "src/lib/content-studio/zero-touch-actions.ts:add a brief to generate" },
  { key: "idea-creation-no-spend", rule: "idea creation consumes no TTS/video resources (paid work begins only on Generate)", enforcedBy: "src/lib/content-studio/idea-actions.ts:generateIdeaAction" },
  { key: "idea-video-consumes-capacity", rule: "video Generate consumes according to the capacity policy", enforcedBy: "src/lib/content-studio/zero-touch-actions.ts:socialGeneratePolicy" },
  { key: "idea-finished-exposes-download", rule: "a finished video exposes a canonical Download (no raw storage path)", enforcedBy: "src/components/content-studio/ZeroTouchStudio.tsx:cs-download" },
  { key: "idea-feed-social-only", rule: "no prospect assets appear in the social idea queue", enforcedBy: "src/lib/content-studio/idea-feed.ts:loadIdeaFeed" },

  // ── Quick Cash operating queue (mandate E §22) — executable release checks ───────
  { key: "quickcash-no-routine-approval", rule: "a routine eligible prospect does not require a per-lead operator approval (autonomous reconcile)", enforcedBy: "src/lib/quick-fix/store.ts:reconcileQuickCashOffers" },
  { key: "quickcash-ready-not-approve-prompt", rule: "READY never simultaneously asks the operator to prepare/approve it", enforcedBy: "src/lib/quick-fix/quick-cash-lifecycle.ts:deriveQuickCashLifecycle" },
  { key: "quickcash-no-fake-scheduled", rule: "delivery OFF cannot display a fake Scheduled state", enforcedBy: "src/lib/quick-fix/quick-cash-lifecycle.ts:prospectDeliveryEnabled" },
  { key: "quickcash-sent-requires-evidence", rule: "the SENT state requires canonical send evidence (outreachState SENT)", enforcedBy: "src/lib/quick-fix/quick-cash-lifecycle.ts:SENT" },
  { key: "quickcash-no-refresh-regression", rule: "a page refresh cannot regress a persisted lifecycle state back to needs-approval", enforcedBy: "src/lib/quick-fix/quick-cash-persistence.test.ts:PREPARING" },
  { key: "quickcash-weak-lead-retires", rule: "a normal weak/ineligible lead retires/replaces rather than waiting for approval", enforcedBy: "src/lib/quick-fix/quick-cash-lifecycle.ts:RETIRED" },
  { key: "quickcash-schedule-only-when-assigned", rule: "a Google-lane schedule is shown only when a real slot is truly assigned (delivery ON)", enforcedBy: "src/lib/quick-fix/quick-cash-lifecycle.ts:schedulable" },
];

export interface InvariantValidation {
  ok: boolean;
  unenforced: Array<{ key: string; ref: string }>;
}

/** Validate every invariant names a real guard (PURE — caller supplies existence resolver). */
export function validateInvariants(guardExists: (ref: string) => boolean): InvariantValidation {
  const unenforced: InvariantValidation["unenforced"] = [];
  for (const inv of BUSINESS_INVARIANTS) if (!guardExists(inv.enforcedBy)) unenforced.push({ key: inv.key, ref: inv.enforcedBy });
  return { ok: unenforced.length === 0, unenforced };
}

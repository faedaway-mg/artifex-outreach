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

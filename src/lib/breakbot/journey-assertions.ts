// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT — SYNTHETIC-JOURNEY ASSERTION RATCHET (mandate §10).
//
// The honest deferred-assertion mechanism, made a RATCHET. Each critical customer/operator
// journey assertion is a stable UI anchor (a data-testid) the Playwright harness asserts. A
// CRITICAL assertion may not sit "deferred": after the selector/session work it must be
// active. A future regression that removes a critical selector (making the interaction
// impossible) must BLOCK — the harness cross-checks this registry against the live DOM, so a
// registry-active anchor missing from the running app is a release-blocking regression, never
// a silent downgrade. Only genuinely non-critical assertions may remain deferred.
//
// PURE data + helpers. The Playwright harness (scripts/breakbot-ui-journeys.ts) supplies the
// set of anchors it actually found; this module decides active / deferred / blocked.
// ─────────────────────────────────────────────────────────────────────────────

export type Criticality = "critical" | "noncritical";
export type AssertionStatus = "active" | "deferred";

export interface JourneyAssertion {
  id: string;
  /** The journey this belongs to (matches personas.ts journey ids / surfaces). */
  surface: string;
  /** The stable DOM anchor (data-testid) the harness asserts is present/visible. */
  testid: string;
  criticality: Criticality;
  /** Declared status. A `critical` assertion MUST be `active` (enforced by the test). */
  status: AssertionStatus;
  /** Why it is deferred (only meaningful for deferred). */
  reason?: string;
  /** First release the assertion became active. */
  firstSupported: string;
}

// The critical set became ACTIVE with the selector/session work in this mandate. Non-critical
// details (deep evidence/QA sub-sections) may remain deferred with a reason.
export const JOURNEY_ASSERTIONS: JourneyAssertion[] = [
  // Operator cockpit sweep (§4/§5)
  { id: "op-app-shell", surface: "operator", testid: "app-shell", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "op-cockpit", surface: "operator", testid: "cockpit", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "op-launch-readiness", surface: "operator", testid: "launch-readiness-gate", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "op-explainer-gallery", surface: "operator", testid: "explainer-coverage-summary", criticality: "critical", status: "active", firstSupported: "d9850f1" },
  { id: "op-breakbot", surface: "operator", testid: "breakbot-overview", criticality: "critical", status: "active", firstSupported: "d9850f1" },

  // Prospect offer journey (§6)
  // Offer identity is carried by the unguessable offerId capability + the personalized-video
  // binding, NOT a visible company label — the hero uses experience/observed-friction framing
  // by design. So company-name is a non-critical (deferred) assertion, not a gating anchor.
  { id: "offer-company", surface: "offer", testid: "company-name", criticality: "noncritical", status: "deferred", reason: "offer hero uses experience framing by design; company identity = offerId capability + personalized-video binding, not a visible label", firstSupported: "" },
  { id: "offer-personalized-video", surface: "offer", testid: "personalized-video", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "offer-trust-video", surface: "offer", testid: "trust-video", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "offer-price", surface: "offer", testid: "price", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "offer-scope", surface: "offer", testid: "scope-and-protections", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "offer-cta", surface: "offer", testid: "checkout-cta", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "offer-finding", surface: "offer", testid: "finding-summary", criticality: "noncritical", status: "deferred", reason: "finding summary copy varies; not a gating interaction", firstSupported: "" },

  // Customer portal (§11)
  { id: "portal-scope", surface: "customer-portal", testid: "portal-scope", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "portal-progress", surface: "customer-portal", testid: "portal-progress", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "portal-next-action", surface: "customer-portal", testid: "portal-next-action", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "portal-evidence", surface: "customer-portal", testid: "portal-evidence", criticality: "noncritical", status: "deferred", reason: "evidence sub-section only present in later states; covered by media QA", firstSupported: "" },

  // Content Studio idea-queue (§10/§14 + idea-queue mandate D)
  { id: "cs-normal", surface: "content-studio", testid: "content-studio-zero-touch", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "cs-idea-input", surface: "content-studio", testid: "cs-idea-input", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "cs-generate", surface: "content-studio", testid: "cs-generate-button", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "cs-capacity", surface: "content-studio", testid: "cs-capacity-card", criticality: "critical", status: "active", firstSupported: "pending-deploy" },

  // Fulfillment (§12)
  { id: "ff-scope", surface: "fulfillment", testid: "fulfillment-scope", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
  { id: "ff-portal-projection", surface: "fulfillment", testid: "fulfillment-portal-projection", criticality: "critical", status: "active", firstSupported: "pending-deploy" },
];

export interface RatchetReport {
  active: JourneyAssertion[];
  deferred: JourneyAssertion[];
  /** Registry-active critical assertions whose anchor was NOT found live — release-blocking (§10). */
  blocked: Array<{ id: string; testid: string; surface: string }>;
}

/**
 * Cross-check the registry against the anchors the harness actually found in the running app.
 * A critical assertion declared `active` whose testid is absent → BLOCKED (a silent downgrade
 * of a critical assertion is exactly what the ratchet forbids). PURE.
 *
 * `drivenSurfaces` scopes the check to the surfaces the harness ACTUALLY visited this run: a
 * surface that was not driven (e.g. the offer page when no offer fixture was supplied) is
 * untested, not "missing" — its anchors are neither counted as found nor as blocked. Omit it
 * to check every surface (the full-coverage run).
 */
export function ratchetReport(foundTestids: Set<string>, drivenSurfaces?: Set<string>): RatchetReport {
  const inScope = (a: JourneyAssertion) => !drivenSurfaces || drivenSurfaces.has(a.surface);
  const active = JOURNEY_ASSERTIONS.filter((a) => a.status === "active");
  const deferred = JOURNEY_ASSERTIONS.filter((a) => a.status === "deferred");
  const blocked = active
    .filter((a) => a.criticality === "critical" && inScope(a) && !foundTestids.has(a.testid))
    .map((a) => ({ id: a.id, testid: a.testid, surface: a.surface }));
  return { active, deferred, blocked };
}

/** No CRITICAL assertion may sit deferred (enforced by the unit test). */
export function criticalDeferred(): JourneyAssertion[] {
  return JOURNEY_ASSERTIONS.filter((a) => a.criticality === "critical" && a.status === "deferred");
}

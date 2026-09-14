// ─────────────────────────────────────────────────────────────────────────────
// Problem-Reality — the needle-in-the-haystack qualification core.
//
// A finding is only a real opportunity when a MATERIAL digital failure is
// actually interfering with a customer doing business with the prospect, AND the
// system has tried and FAILED to disprove it. A shitty-looking site that WORKS
// does not qualify. This module models that judgment and — for browser-dependent
// claims — records the result of an ACTUAL live counter-test (see counter-test.ts).
//
// PLANNED never satisfies EXECUTED: a browser-dependent hypothesis can only reach
// PROVEN via a real execution that failed to find a working path.
// ─────────────────────────────────────────────────────────────────────────────

/** The concrete thing a customer is trying to do that a problem interferes with. */
export type PrimaryCustomerAction =
  | "booking"
  | "appointment"
  | "contact"
  | "quote"
  | "navigation"
  | "mobile-interaction"
  | "forms"
  | "service-location-selection"
  | "cta-availability"
  | "non-interactive"; // e.g. HTTPS/perf/SEO — not a click-path claim

/** Final judgment on whether the claimed problem is real and material. */
export type ProblemRealityStatus =
  | "PROVEN"          // a specific defect is reproducibly present — supports a direct claim
  | "OBSERVED"        // a specific condition was genuinely observed, but external testing
                      // cannot establish it is defective/causal/material — CONVERSATION only
  | "NEEDS_MORE_EVIDENCE"
  | "DISPROVEN"
  | "NO_MATERIAL_PROBLEM";

export interface ProblemHypothesis {
  /** Stable id (derived from finding or generated). */
  id: string;
  /** The claim we will actively try to DISPROVE, e.g. "No usable booking path". */
  claim: string;
  /** What the customer is trying to do. */
  primaryCustomerAction: PrimaryCustomerAction;
  /** True when only a live browser interaction can settle it (booking/contact/etc.). */
  browserDependent: boolean;
  /** Optional link back to the finding that seeded this hypothesis. */
  sourceFindingId?: string;
  /** The site the counter-test runs against. */
  url: string;
}

/** One thing the counter-test actually did, for the canonical record. */
export interface CounterTestAction {
  step: string;             // "dismiss-overlay" | "open-mobile-menu" | "click" | "scan" | "goto" ...
  target?: string;          // selector / link text / url
  viewport?: "desktop" | "mobile";
  observation: string;      // what happened
}

/** An alternate working path discovered while trying to disprove the claim. */
export interface AlternatePath {
  kind: "link" | "button" | "widget" | "tel" | "email" | "form" | "page";
  detail: string;           // e.g. "Header link 'Book Now' → https://…/book"
  viewport: "desktop" | "mobile";
}

// ── Problem-Reality DIMENSIONS (distinct from the verdict) ───────────────────
// A reproducible defect is a FACT about the tested surface. Its business impact
// is a SEPARATE judgment: an alternate path can REDUCE the impact of a defect, it
// does NOT make the reproducible defect disappear. So we record three orthogonal
// dimensions alongside the verdict.

/** How badly the defect plausibly affects a meaningful customer/business function. */
export type DefectSeverity = "HIGH" | "MEDIUM" | "LOW";
/** Whether another path lets the customer still reach the goal (reduces impact). */
export type DefectMitigation = "NONE" | "PARTIAL" | "STRONG";
/** Whether the (PROVEN) defect clears the materiality threshold for outreach. */
export type Materiality = "PASS" | "FAIL";

/** A reproducible, auditable failure of the INTENDED customer surface (families
 *  A–G in the doctrine). This is what makes a verdict PROVEN — never the mere
 *  absence of an alternate path, and never erased by one. */
export interface DefectObservation {
  /** Objective-defect family: broken-cta | dead-destination | broken-booking |
   *  broken-form | mobile-failure | technical-failure | contact-path | no-path | cosmetic */
  family: string;
  /** Human-readable, evidence-grounded description of the failure. */
  detail: string;
  /** Viewports the failure reproduced in. */
  viewports: Array<"desktop" | "mobile">;
}

/** The canonical, persisted result of an ACTUAL execution (never a plan). */
export interface CounterTestExecution {
  hypothesisId: string;
  claim: string;
  url: string;
  /** MUST be true to count — a plan alone is not an execution. */
  executed: boolean;
  startedAt: string;
  finishedAt: string;
  pagesVisited: string[];
  actionsAttempted: CounterTestAction[];
  statesObserved: string[];
  alternatePathsFound: AlternatePath[];
  /** Non-disruptive guarantee: true when no external side effect could have occurred. */
  nonDisruptive: boolean;
  verdict: ProblemRealityStatus;
  /** Human-readable why, grounded in observed states. */
  rationale: string;
  /** The reproducible defect that drove a PROVEN verdict, if any. */
  defect?: DefectObservation | null;
  /** Impact of the defect given any alternate paths (PROVEN only). */
  severity?: DefectSeverity;
  /** How much an alternate path reduces the defect's impact (PROVEN only). */
  mitigation?: DefectMitigation;
  /** Whether a PROVEN defect clears the materiality threshold for outreach. */
  materiality?: Materiality;
  /** How completely the evidence harvester inspected the surface (fail-closed gate). */
  harvestCompleteness?: "COMPLETE" | "PARTIAL" | "BLOCKED";
  /** How the probe itself fared (a raw/WAF block never overrides a browser render). */
  probeStatus?: "BROWSER_SUCCESS" | "HTTP_FETCH_BLOCKED" | "BOT_CHALLENGE" | "INDETERMINATE";
  /** Screenshot storage keys captured during the test (evidence), if any. */
  evidenceShots: string[];
  error?: string;
}

/** The rolled-up Problem-Reality for a hypothesis: status + the execution that
 *  produced it (for browser-dependent claims) or the deterministic basis. */
export interface ProblemReality {
  hypothesis: ProblemHypothesis;
  status: ProblemRealityStatus;
  /** Present iff a live counter-test was executed. */
  execution?: CounterTestExecution;
  basis: "live-counter-test" | "deterministic" | "not-executed";
  decidedAt: string;
}

/** Only PROVEN continues downstream. */
export function continuesDownstream(pr: ProblemReality): boolean {
  return pr.status === "PROVEN" && (!pr.hypothesis.browserDependent || pr.basis === "live-counter-test");
}

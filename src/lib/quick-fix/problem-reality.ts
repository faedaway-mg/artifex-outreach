// ─────────────────────────────────────────────────────────────────────────────
// PROBLEM REALITY GATE (Problem-Reality amendment §1, §2, §33, §34).
//
// The engine must stop trying to turn a weak observation into an offer. "No material
// problem" is a SUCCESSFUL qualification result: a working site with no demonstrable
// friction should be REJECTED and replaced, not dressed up in a consulting suggestion.
//
// A sellable problem must pass ALL applicable reality criteria — OBSERVABLE, REPEATABLE,
// SPECIFIC, MATERIAL, EVIDENCE-BACKED, FIXABLE, COHERENT, TRUTHFUL — and, for a functional
// path claim, survive a COUNTER-TEST that actively tries to DISPROVE it (§34: if Book Now →
// postal code → valid flow is found, the "no booking" hypothesis dies). The verdict is an
// explicit PROBLEM REALITY score independent of fixability / evidence-confidence / send-value.
// Only PROVEN problems may consume paid production or reach Ready-to-Send.
//
// PURE — the caller gathers the signals (from the scan + counter-test browser journey);
// this module only judges them, so it is deterministic + unit-testable and Breakbot runs
// it over every real active package (§29/§33).
// ─────────────────────────────────────────────────────────────────────────────
import { isMaterialFinding } from "./evidence-gate";
import { classifyDefectFamily } from "./subject-engine";

export type ProblemRealityVerdict = "PROVEN" | "PLAUSIBLE" | "WEAK" | "DISPROVEN" | "NO_MATERIAL_PROBLEM";

/** The result of actively trying to disprove a functional-path hypothesis (§34). */
export interface CounterTest {
  /** We actually ran the adversarial browser journey (menu / search / footer / selector). */
  attempted: boolean;
  /** A working path was found → the "it's broken/missing" hypothesis is DISPROVEN. */
  foundWorkingPath: boolean;
}

export interface ProblemRealityInput {
  finding: { observation: string; whyItMatters?: string } | null;
  /** We actually saw the behavior in a real browser (not inferred from page text). */
  observed: boolean;
  /** The finding survived a re-check — not a transient load / cookie-overlay artifact (§9). */
  repeatable: boolean;
  /** Names a specific path/control/state, not generic website criticism (§3). */
  specific: boolean;
  /** Screenshots / the browser journey visibly support the claim. */
  evidenceBacked: boolean;
  /** Artifex can reasonably repair it within the proposed scope. */
  fixable: boolean;
  /** The problem maps clearly to the offer being sold (§20). */
  coherent: boolean;
  /** We do not claim an action/test occurred unless it actually did (§19). */
  truthful: boolean;
  /** The counter-test result for a functional-path claim (null when not yet run). */
  counterTest: CounterTest | null;
}

export interface ProblemReality {
  verdict: ProblemRealityVerdict;
  /** 0..100 — a transparent roll-up of the satisfied criteria (NOT a send-value/price signal). */
  score: number;
  /** Whether this problem may consume paid production / reach Ready-to-Send (PROVEN only). */
  proceedsToPaid: boolean;
  /** Per-criterion pass/fail (audit + operator display). */
  criteria: Record<string, boolean>;
  /** Whether this finding class is a functional-path claim that REQUIRES a counter-test. */
  requiresCounterTest: boolean;
  reasons: string[];
}

const PATH_FAMILIES = new Set(["booking", "mobile_booking", "contact", "mobile_contact"]);
// Path-type language even outside the subject families (nav / links / checkout / forms).
const PATH_SIGNAL = /\b(book|booking|appointment|schedule|contact|form|inquir|submit|checkout|cart|nav|menu|link|button|cta|sign up|signup|register|quote|order)\b/i;

/** Whether a finding is a functional-path claim (so it must survive a disprove counter-test, §34). */
export function isFunctionalPathClaim(observation: string): boolean {
  const family = classifyDefectFamily({ observation });
  if (PATH_FAMILIES.has(family)) return true;
  return PATH_SIGNAL.test(observation);
}

const CRITERIA_ORDER = ["observed", "repeatable", "specific", "material", "evidenceBacked", "fixable", "coherent", "truthful"] as const;

/**
 * Judge a candidate problem's REALITY. Deterministic + pure. Returns NO_MATERIAL_PROBLEM
 * (a good result) for a working site / immaterial finding; DISPROVEN when a counter-test
 * found a working path; PROVEN only when every applicable criterion holds AND, for a
 * functional-path claim, the disprove counter-test was run and did NOT find a working path.
 */
export function assessProblemReality(input: ProblemRealityInput): ProblemReality {
  const reasons: string[] = [];

  if (!input.finding) {
    return noMaterial(["no evidence-backed finding — the site works / nothing compelling to fix"]);
  }
  const material = isMaterialFinding({ observation: input.finding.observation, whyItMatters: input.finding.whyItMatters ?? "" });
  const requiresCounterTest = isFunctionalPathClaim(input.finding.observation);

  const criteria: Record<string, boolean> = {
    observed: input.observed,
    repeatable: input.repeatable,
    specific: input.specific,
    material,
    evidenceBacked: input.evidenceBacked,
    fixable: input.fixable,
    coherent: input.coherent,
    truthful: input.truthful,
  };

  // A working path found by the counter-test kills the hypothesis outright (§34/§6).
  if (requiresCounterTest && input.counterTest?.foundWorkingPath) {
    return {
      verdict: "DISPROVEN",
      score: scoreOf(criteria),
      proceedsToPaid: false,
      criteria,
      requiresCounterTest,
      reasons: ["counter-test found a working path — the claimed broken/missing path hypothesis is DISPROVEN"],
    };
  }

  // Immaterial / working site ⇒ NO_MATERIAL_PROBLEM is the correct, successful result (§1/§3).
  if (!material) return { ...noMaterial(["finding is immaterial — not a compelling Quick-Fix problem"]), criteria, requiresCounterTest };

  // Can't even trust the observation ⇒ WEAK.
  if (!input.observed || !input.specific || !input.truthful) {
    if (!input.truthful) reasons.push("copy would claim an action/test that did not occur");
    if (!input.observed) reasons.push("not actually observed in a real browser journey");
    if (!input.specific) reasons.push("not specific — generic website criticism, no concrete path/control");
    return { verdict: "WEAK", score: scoreOf(criteria), proceedsToPaid: false, criteria, requiresCounterTest, reasons };
  }

  const core = input.observed && input.specific && material && input.truthful && input.coherent && input.fixable;
  const counterTestCleared = requiresCounterTest ? !!(input.counterTest?.attempted && !input.counterTest.foundWorkingPath) : true;

  if (core && input.evidenceBacked && input.repeatable && counterTestCleared) {
    return { verdict: "PROVEN", score: scoreOf(criteria), proceedsToPaid: true, criteria, requiresCounterTest, reasons: ["all reality criteria satisfied" + (requiresCounterTest ? " and the disprove counter-test held" : "")] };
  }

  // Real enough to keep investigating, not yet provable.
  if (core) {
    if (!input.evidenceBacked) reasons.push("evidence does not yet visibly prove the claim");
    if (!input.repeatable) reasons.push("not re-checked — could be a transient/cookie artifact");
    if (requiresCounterTest && !counterTestCleared) reasons.push("disprove counter-test not yet run — must attempt to find a working path first");
    return { verdict: "PLAUSIBLE", score: scoreOf(criteria), proceedsToPaid: false, criteria, requiresCounterTest, reasons };
  }

  if (!input.fixable) reasons.push("not clearly fixable within a Quick-Fix scope");
  if (!input.coherent) reasons.push("does not map cleanly to a single sellable offer");
  return { verdict: "WEAK", score: scoreOf(criteria), proceedsToPaid: false, criteria, requiresCounterTest, reasons };
}

function scoreOf(criteria: Record<string, boolean>): number {
  const total = CRITERIA_ORDER.length;
  const met = CRITERIA_ORDER.filter((k) => criteria[k]).length;
  return Math.round((met / total) * 100);
}

function noMaterial(reasons: string[]): ProblemReality {
  return {
    verdict: "NO_MATERIAL_PROBLEM",
    score: 0,
    proceedsToPaid: false,
    criteria: Object.fromEntries(CRITERIA_ORDER.map((k) => [k, false])),
    requiresCounterTest: false,
    reasons,
  };
}

export interface CounterTestStep { action: string; observe: string }

/**
 * The adversarial counter-test PLAN for a functional-path hypothesis (§34). The scanner
 * (or operator) runs these to actively try to DISPROVE the finding before it is accepted.
 * Non-disruptive by contract (§8): navigate up to the point that establishes whether the
 * path works — never submit a form, book an appointment, or create an account.
 */
export function counterTestPlan(observation: string): CounterTestStep[] {
  const family = classifyDefectFamily({ observation });
  const booking = family === "booking" || family === "mobile_booking" || /\bbook|appointment|schedule\b/i.test(observation);
  if (booking) {
    return [
      { action: "open the primary navigation / menu", observe: "is there a Book / Appointments / Schedule entry?" },
      { action: "click Book Now / Schedule", observe: "does a real booking flow (calendar / service / location selector) load?" },
      { action: "follow a service/location selector one step", observe: "does the path continue toward booking (do NOT submit)?" },
      { action: "check the footer + header for a booking/phone action", observe: "is there another working path to book?" },
    ];
  }
  const contact = family === "contact" || family === "mobile_contact" || /\bcontact|inquir|form|quote\b/i.test(observation);
  if (contact) {
    return [
      { action: "open the navigation and look for Contact / Get a Quote", observe: "is there a working contact entry point?" },
      { action: "open the contact page", observe: "does a usable contact form / phone / email load (do NOT submit)?" },
      { action: "check the footer for contact actions", observe: "is there another working way to get in touch?" },
    ];
  }
  return [
    { action: "re-load the page and dismiss any cookie/consent overlay", observe: "does the supposed problem persist once the overlay is gone (§9)?" },
    { action: "scroll the full page + open menus", observe: "is the expected control actually present further down or in a menu?" },
  ];
}

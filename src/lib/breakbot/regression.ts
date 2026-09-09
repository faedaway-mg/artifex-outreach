// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT RELEASE-REGRESSION (Part U) — the pure, offline pre-deploy gate.
//
// Runs the 5 GOLDEN + 20 FAILURE fixtures through the FINISHED runBreakbotPreflight
// engine and asserts each golden returns READY and each failure returns BLOCKED with
// its EXACT expected blocker surface. Pure/offline: NO store, NO DB, NO provider, NO
// sends, NO charges — it only reads the self-contained fixtures + the fixed contracts.
//
// A CRITICAL regression is any golden that is not READY or any failure that does not
// BLOCK on its expected surface. The caller (scripts/breakbot-regression.ts) exits
// nonzero on any critical regression; the operator batch surface renders the summary.
//
// This is OPERATOR-SIDE code (a release gate + a UI feed) that composes the frozen
// engine + fixtures — it never re-implements or mutates them.
// ─────────────────────────────────────────────────────────────────────────────
import { runBreakbotPreflight } from "./quickcash-preflight";
import { goldenFixtures, failureFixtures } from "./quickcash-fixtures";

export interface GoldenResult {
  id: string;
  label: string;
  overall: "READY" | "BLOCKED";
  blockers: number;
  /** The blocker surfaces (should be empty for a golden). */
  blockerSurfaces: string[];
  /** True when the golden is READY as required. */
  pass: boolean;
}

export interface FailureResult {
  id: string;
  label: string;
  expectBlockerSurface: string;
  overall: "READY" | "BLOCKED";
  blockers: number;
  blockerSurfaces: string[];
  /** True when BLOCKED and the expected blocker surface is present. */
  pass: boolean;
}

export interface RegressionResult {
  golden: GoldenResult[];
  failure: FailureResult[];
  goldenPassed: number;
  goldenTotal: number;
  failurePassed: number;
  failureTotal: number;
  /** True only when EVERY golden is READY and EVERY failure blocks on its surface. */
  allPass: boolean;
  /** The failing cases (empty when allPass) — legible for the gate output. */
  regressions: Array<{ id: string; kind: "golden" | "failure"; reason: string }>;
}

const blockerSurfacesOf = (issues: ReturnType<typeof runBreakbotPreflight>["issues"]) =>
  Array.from(new Set(issues.filter((i) => i.severity === "BLOCKER").map((i) => i.surface)));

/**
 * Run the full golden + failure regression. Pure — safe to call from a script, an API
 * route, or a test. Never touches the store, the DB, a provider, or the send queue.
 */
export function runRegression(): RegressionResult {
  const regressions: RegressionResult["regressions"] = [];

  const golden: GoldenResult[] = goldenFixtures().map((g) => {
    const v = runBreakbotPreflight(g.input);
    const blockerSurfaces = blockerSurfacesOf(v.issues);
    const pass = v.overall === "READY";
    if (!pass) regressions.push({ id: g.id, kind: "golden", reason: `expected READY, got BLOCKED [${blockerSurfaces.join(", ")}]` });
    return { id: g.id, label: g.label, overall: v.overall, blockers: v.counts.blockers, blockerSurfaces, pass };
  });

  const failure: FailureResult[] = failureFixtures().map((f) => {
    const v = runBreakbotPreflight(f.input);
    const blockerSurfaces = blockerSurfacesOf(v.issues);
    const blocked = v.overall === "BLOCKED";
    const hasExpected = blockerSurfaces.includes(f.expectBlockerSurface);
    const pass = blocked && hasExpected;
    if (!pass) {
      const reason = !blocked
        ? `expected BLOCKED on "${f.expectBlockerSurface}", but overall was READY`
        : `expected blocker "${f.expectBlockerSurface}", got [${blockerSurfaces.join(", ")}]`;
      regressions.push({ id: f.id, kind: "failure", reason });
    }
    return { id: f.id, label: f.label, expectBlockerSurface: f.expectBlockerSurface, overall: v.overall, blockers: v.counts.blockers, blockerSurfaces, pass };
  });

  const goldenPassed = golden.filter((g) => g.pass).length;
  const failurePassed = failure.filter((f) => f.pass).length;
  return {
    golden,
    failure,
    goldenPassed,
    goldenTotal: golden.length,
    failurePassed,
    failureTotal: failure.length,
    allPass: regressions.length === 0,
    regressions,
  };
}

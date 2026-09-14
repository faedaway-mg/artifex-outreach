// ─────────────────────────────────────────────────────────────────────────────
// Problem-Reality orchestrator. For a lead: derive hypotheses, EXECUTE a live
// counter-test for each browser-dependent claim, and roll up a ProblemReality.
// Only PROVEN (from an actual execution, for browser-dependent claims) continues.
// ─────────────────────────────────────────────────────────────────────────────
import type { ProblemReality, ProblemHypothesis } from "./types";
import { continuesDownstream } from "./types";
import { deriveHypotheses } from "./hypothesis";
import { executeCounterTest, type CounterTestOptions } from "./counter-test";

export * from "./types";
export { deriveHypotheses, expectedPrimaryAction, classifyAction, isBrowserDependent } from "./hypothesis";
export { decideVerdict, actionMatchesText } from "./verdict";
export { executeCounterTest } from "./counter-test";

export interface AssessInput {
  lead: { id: string; industry: string; website?: string | null };
  findings?: Array<{ id: string; title: string; observation?: string; category?: string }>;
}

/** Assess one hypothesis: run the live counter-test iff browser-dependent. */
export async function assessHypothesis(h: ProblemHypothesis, opts?: CounterTestOptions): Promise<ProblemReality> {
  const decidedAt = new Date().toISOString();
  if (!h.browserDependent) {
    // Deterministic (HTTPS/perf/SEO) claims are settled elsewhere; here we only
    // record that no live counter-test was executed — they do NOT auto-continue.
    return { hypothesis: h, status: "NEEDS_MORE_EVIDENCE", basis: "not-executed", decidedAt };
  }
  const execution = await executeCounterTest(h, opts);
  return { hypothesis: h, status: execution.verdict, execution, basis: execution.executed ? "live-counter-test" : "not-executed", decidedAt };
}

/** Full lead assessment. Returns every hypothesis's Problem-Reality + whether the
 *  lead has at least one PROVEN, live-verified problem (⇒ it may continue). */
export async function assessLead(input: AssessInput, opts?: CounterTestOptions): Promise<{
  results: ProblemReality[];
  qualifies: boolean;
  proven: ProblemReality[];
}> {
  const hypotheses = deriveHypotheses(input.lead, input.findings ?? []);
  const results: ProblemReality[] = [];
  for (const h of hypotheses) results.push(await assessHypothesis(h, opts));
  const proven = results.filter(continuesDownstream);
  return { results, qualifies: proven.length > 0, proven };
}

// ─────────────────────────────────────────────────────────────────────────────
// Counter-test RUNNER abstraction. The live browser must run OUTSIDE the Next web
// request path (a fragile browser in-request is a reliability risk — same reason
// screenshots go to a worker). So:
//   • production/web  → delegate to a browser worker over HTTP (/counter-test)
//   • scripts/dev/worker → run Playwright inline (executeCounterTest)
// The qualification funnel depends only on this interface, so the "scan performs
// the reality test" without the web service embedding a browser.
// ─────────────────────────────────────────────────────────────────────────────
import type { ProblemHypothesis, CounterTestExecution } from "./types";
import { executeCounterTest } from "./counter-test";

export interface CounterTestRunner {
  kind: "inline" | "worker";
  run(h: ProblemHypothesis): Promise<CounterTestExecution>;
}

/** Runs Playwright in-process. For scripts, the reality-check worker, and dev. */
export const inlineRunner: CounterTestRunner = {
  kind: "inline",
  run: (h) => executeCounterTest(h),
};

/** Delegates to a browser worker that runs the counter-test and returns the
 *  canonical execution. Used by the web/serverless path so it never launches a
 *  browser itself. */
export function workerRunner(url: string, token?: string): CounterTestRunner {
  return {
    kind: "worker",
    run: async (h) => {
      const started = new Date().toISOString();
      try {
        const res = await fetch(`${url.replace(/\/$/, "")}/counter-test`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
          body: JSON.stringify({ hypothesis: h }),
        });
        if (!res.ok) throw new Error(`counter-test worker ${res.status}`);
        return (await res.json()) as CounterTestExecution;
      } catch (e) {
        // Fail CLOSED: an un-run counter-test is NOT executed, so it cannot promote.
        return {
          hypothesisId: h.id, claim: h.claim, url: h.url, executed: false,
          startedAt: started, finishedAt: new Date().toISOString(), pagesVisited: [],
          actionsAttempted: [], statesObserved: [], alternatePathsFound: [], nonDisruptive: true,
          verdict: "NEEDS_MORE_EVIDENCE", rationale: "counter-test worker unavailable", evidenceShots: [],
          error: (e as Error).message,
        };
      }
    },
  };
}

/** The runner selected by environment: worker when a URL is configured, else inline. */
export function defaultRunner(env: NodeJS.ProcessEnv = process.env): CounterTestRunner {
  const url = env.COUNTER_TEST_WORKER_URL || env.SCREENSHOT_WORKER_URL;
  if (url) return workerRunner(url, env.COUNTER_TEST_WORKER_TOKEN || env.SCREENSHOT_WORKER_TOKEN);
  return inlineRunner;
}

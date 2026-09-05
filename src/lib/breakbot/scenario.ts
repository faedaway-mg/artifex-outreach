// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT SYNTHETIC-USER SCENARIO CONTRACT (mandate 19). A reusable, width-aware acceptance contract:
// every scenario asserts the FULL truth (visible UI + persisted state + audit + counts + scheduler dry-run
// + fake-provider calls), never screenshots alone. Shared by the foundation smoke journey and later mandates.
// ─────────────────────────────────────────────────────────────────────────────

export interface Viewport { label: "mobile" | "tablet" | "desktop"; width: number; height: number; }
export const VIEWPORTS: Viewport[] = [
  { label: "mobile", width: 390, height: 844 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop", width: 1440, height: 1000 },
];

export interface Assertion { name: string; ok: boolean; detail?: string; }

export interface ScenarioResult {
  name: string;
  goal: string;
  viewport: Viewport["label"];
  startingFixtures: string[];         // fixture ids seeded
  actions: string[];                  // browser actions taken (human-readable log)
  assertions: Assertion[];            // UI + persisted + audit + count + dry-run checks
  fakeProviderCalls: number;          // must be recorded inside the isolated run
  externalProviderCalls: number;      // MUST be 0
  productionMutations: number;        // MUST be 0
  screenshots: string[];
  tracePath: string | null;
  pass: boolean;
  failReasons: string[];
}

/** Fold a set of assertions + the zero-contamination invariants into a pass/fail verdict. */
export function verdict(r: Omit<ScenarioResult, "pass" | "failReasons">): ScenarioResult {
  const failReasons: string[] = [];
  for (const a of r.assertions) if (!a.ok) failReasons.push(`${a.name}${a.detail ? ` (${a.detail})` : ""}`);
  if (r.externalProviderCalls !== 0) failReasons.push(`external provider calls = ${r.externalProviderCalls} (must be 0)`);
  if (r.productionMutations !== 0) failReasons.push(`production mutations = ${r.productionMutations} (must be 0)`);
  return { ...r, pass: failReasons.length === 0, failReasons };
}

export interface Scenario {
  name: string;
  goal: string;
  fixtureIds: string[];               // which fixtures this scenario seeds
  /** Browser actions + assertions; returns the per-viewport result (pass only when EVERY facet is proven). */
  run(ctx: ScenarioContext): Promise<ScenarioResult>;
}

export interface ScenarioContext {
  viewport: Viewport;
  baseUrl: string;
  seed(fixtureIds: string[]): Promise<{ seeded: string[]; manifestHash: string }>;
  reset(): Promise<void>;
  fakeProviderCallCount(): Promise<number>;
  screenshot(name: string): Promise<string>;
}

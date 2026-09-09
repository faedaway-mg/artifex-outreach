// Minimal Playwright config for Breakbot rendered-browser visual QA.
//
// NOTE: the visual QA harness (scripts/breakbot-visual.ts) is a standalone script,
// not a @playwright/test spec, so it does not require this config to run. This file
// exists so any future `@playwright/test` specs have a single chromium project and a
// sensible default. It deliberately does NOT touch vitest: vitest.config.ts owns the
// unit suite (src/**/*.test.ts) and never loads this file, and this config's testDir
// is scoped to tests/visual so it will not pick up vitest tests.
import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  // Only match Playwright specs; the pure vitest unit tests live under src/ and use
  // the *.test.ts extension there, which this testDir/testMatch will never see.
  testMatch: /.*\.pw\.(spec|test)\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    headless: true,
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

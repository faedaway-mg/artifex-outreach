import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Use the automatic JSX runtime (like Next) so component files that render JSX
  // don't need an explicit `import React` under vitest's esbuild transform.
  esbuild: { jsx: "automatic" },
  // testTimeout raised above the default 5s: the @react-pdf renderer is CPU-heavy
  // and can exceed 20s under heavy parallel load, causing spurious timeouts in CI.
  // Default environment is node (the whole existing suite). Component tests opt into a
  // jsdom environment per-file with a `// @vitest-environment jsdom` docblock, so nothing
  // else pays the DOM cost. `.test.tsx` is included alongside `.test.ts`.
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"], setupFiles: ["src/test-setup.ts"], testTimeout: 30000 },
});

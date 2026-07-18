import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // testTimeout raised above the default 5s: the @react-pdf renderer is CPU-heavy
  // and can exceed 5s under parallel load, causing spurious timeouts in CI.
  test: { environment: "node", include: ["src/**/*.test.ts"], setupFiles: ["src/test-setup.ts"], testTimeout: 20000 },
});

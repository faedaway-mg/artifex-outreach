// Env-only DB guards (no `postgres` import) so they are safe to load from the
// instrumentation hook, which is compiled for both the edge and node runtimes.
export function hasDb(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function assertProductionDb(): void {
  if (process.env.NODE_ENV === "production" && !hasDb()) {
    throw new Error(
      "FATAL: NODE_ENV=production but DATABASE_URL is not set. Artifex Outreach refuses to start with in-memory storage in production.",
    );
  }
}

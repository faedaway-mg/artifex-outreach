// Runs once at server startup (Next.js instrumentation hook). Enforces production
// safety: a real database and secure auth config are mandatory in production.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionDb } = await import("./db/guard");
  const { assertAuthConfigured } = await import("./lib/auth-config");
  assertProductionDb();
  assertAuthConfigured();
  if (process.env.NODE_ENV === "production") {
    console.info("[startup] Artifex Outreach — production checks passed (database + auth configured).");
  }
}

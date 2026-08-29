// Content Studio — environment safety guard. Distinguishes development/test/staging/production and
// FAILS CLOSED against the dangerous mixups: production silently using local storage, the web process
// rendering, delivery/autosend/payment flags being on during a staging acceptance run, or a staging
// marker leaking into production. Composed from the storage factory's fail-closed resolver + explicit
// flag checks. Pure + testable.

import { resolveStorageMode } from "./storage-factory";

export type CsEnvironment = "development" | "test" | "staging" | "production";

export function csEnvironment(env: NodeJS.ProcessEnv = process.env): CsEnvironment {
  const e = (env.CS_ENV ?? "").trim().toLowerCase();
  if (e === "staging" || e === "production" || e === "development" || e === "test") return e;
  if (env.NODE_ENV === "production") return "production";
  if (env.NODE_ENV === "test") return "test";
  return "development";
}

// Delivery / autosend / payment flags that must be OFF for any Content Studio run (staging or prod).
const DELIVERY_FLAGS = ["COMMS_PROSPECT_DELIVERY_ENABLED", "QR_AUTOSEND_ENABLED", "COMMS_AUTOSEND_ENABLED"] as const;
function enabledDeliveryFlags(env: NodeJS.ProcessEnv): string[] {
  return DELIVERY_FLAGS.filter((f) => { const v = (env[f] ?? "").toLowerCase(); return v === "1" || v === "true" || v === "on" || v === "yes"; });
}

// Guard a STAGING acceptance run: refuse if it would touch production data/identity or if delivery is on.
export function assertStagingAcceptanceSafe(env: NodeJS.ProcessEnv = process.env): void {
  const problems: string[] = [];
  if (csEnvironment(env) === "production") problems.push("environment resolves to production (staging acceptance must run against staging)");
  // A staging DB must be explicitly named — and must not be the production application DB.
  const dbUrl = env.CS_DATABASE_URL || env.DATABASE_URL || "";
  if (!env.CS_STAGING_MARKER) problems.push("CS_STAGING_MARKER not set (staging DB must carry a verified staging marker)");
  if (/prod|production/i.test(env.RAILWAY_ENVIRONMENT_NAME ?? "")) problems.push("Railway environment name looks like production");
  if (dbUrl && /prod/i.test(dbUrl) && !/stag/i.test(dbUrl)) problems.push("database URL looks like the production application DB");
  try { if (resolveStorageMode(env) !== "postgres") problems.push("staging must use PostgreSQL storage, not local"); }
  catch (e: any) { problems.push("storage config invalid: " + e.message); }
  const flags = enabledDeliveryFlags(env);
  if (flags.length) problems.push("delivery/autosend flags are ON: " + flags.join(", "));
  if (problems.length) throw new Error("Content Studio staging acceptance REFUSED:\n - " + problems.join("\n - "));
}

// Guard PRODUCTION runtime: refuse local storage, web-process rendering, a staging marker, or delivery on.
export function assertProductionRuntimeSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (csEnvironment(env) !== "production") return; // only enforced in production
  const problems: string[] = [];
  try { if (resolveStorageMode(env) !== "postgres") problems.push("production must use PostgreSQL storage"); }
  catch (e: any) { problems.push(e.message); }
  if (env.CS_RENDER_MODE === "local") problems.push("CS_RENDER_MODE=local in production (the web process must not render)");
  if (env.CS_STAGING_MARKER) problems.push("a staging marker is present in production");
  const flags = enabledDeliveryFlags(env);
  if (flags.length) problems.push("delivery/autosend flags are ON: " + flags.join(", "));
  if (problems.length) throw new Error("Content Studio production runtime REFUSED:\n - " + problems.join("\n - "));
}

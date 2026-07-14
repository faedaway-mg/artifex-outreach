// Env-only auth configuration + production guards (no node `crypto` import) so
// they are safe to load from the instrumentation hook (edge + node compilation).
export const DEV_PASSWORD = "artifex"; // dev only; rejected in production
export const DEV_SECRET = "artifex-outreach-dev-secret"; // dev only; rejected in production
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export const isProd = () => process.env.NODE_ENV === "production";

export function assertAuthConfigured(): void {
  if (!isProd()) return;
  const pw = process.env.OUTREACH_PASSWORD;
  const sec = process.env.AUTH_SECRET;
  const problems: string[] = [];
  if (!pw || pw.length < 8 || pw === DEV_PASSWORD || pw === "change-me")
    problems.push("OUTREACH_PASSWORD missing or insecure (need ≥8 chars, non-default)");
  if (!sec || sec.length < 16 || sec === DEV_SECRET)
    problems.push("AUTH_SECRET missing or insecure (need ≥16 chars, non-default)");
  if (problems.length) throw new Error(`FATAL: insecure production auth config → ${problems.join("; ")}`);
}

export function authConfigOk(): boolean {
  try {
    assertAuthConfigured();
    return true;
  } catch {
    return false;
  }
}

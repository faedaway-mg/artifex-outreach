// ─────────────────────────────────────────────────────────────────────────────
// BREAKBOT ISOLATED TEST FOUNDATION — the fail-closed guard rails (mandate 19). Breakbot may run ONLY in a
// genuinely isolated in-memory namespace with a fake provider and reserved non-deliverable recipients. If
// anything could resolve to production (a real DB, a real provider key, a missing tenant flag, a real
// recipient domain), Breakbot refuses to start. Pure + fully unit-tested; imported only by tests/harness.
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical synthetic provenance — the production dispatch boundary already REJECTS this source (mandate 17). */
export const BREAKBOT_PROVENANCE = "breakbot";
/** Reserved non-deliverable recipient domain (RFC 6761 .invalid) — no MX, can never receive mail. */
export const RESERVED_TEST_DOMAIN = "example.invalid";
export const BREAKBOT_TENANT_ENV = "BREAKBOT_TEST_TENANT";

type Env = Record<string, string | undefined>;

export function isBreakbotTenant(env: Env = process.env): boolean {
  return env[BREAKBOT_TENANT_ENV] === "1";
}

/**
 * FAIL-CLOSED isolation assertion. Throws (refusing to start) unless the runtime is a genuinely isolated
 * Breakbot tenant: the test flag is set, NO database URL is configured (so the store is in-memory, never a
 * real DB), and NO real provider key is present (so a real send is structurally impossible).
 */
export function assertIsolatedStore(env: Env = process.env): void {
  if (!isBreakbotTenant(env)) throw new Error("Breakbot refused to start: BREAKBOT_TEST_TENANT != \"1\" (fail-closed).");
  if (env.DATABASE_URL) throw new Error("Breakbot refused to start: DATABASE_URL is set — the store would resolve to a real database (fail-closed).");
  if (env.CS_DATABASE_URL) throw new Error("Breakbot refused to start: CS_DATABASE_URL is set — content-studio would resolve to a real database (fail-closed).");
  if (env.RESEND_API_KEY) throw new Error("Breakbot refused to start: RESEND_API_KEY present — a real provider could send (fail-closed).");
}

/** True only when the current environment is a safe isolated Breakbot tenant (no throw). */
export function isolatedStoreOk(env: Env = process.env): boolean {
  try { assertIsolatedStore(env); return true; } catch { return false; }
}

/** A Breakbot recipient MUST be under the reserved non-deliverable domain — reject any real-world domain. */
export function assertFakeRecipient(email: string): void {
  const at = (email ?? "").lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1).toLowerCase() : "";
  if (domain !== RESERVED_TEST_DOMAIN && !domain.endsWith("." + RESERVED_TEST_DOMAIN)) {
    throw new Error(`Breakbot refused: recipient "${email}" is not under the reserved ${RESERVED_TEST_DOMAIN} domain (fail-closed).`);
  }
}

export function isFakeRecipient(email: string): boolean {
  try { assertFakeRecipient(email); return true; } catch { return false; }
}

/** Env a Breakbot process must run with — no DB, fake provider on, tenant flag set, non-production. */
export function breakbotEnv(): Record<string, string> {
  return { [BREAKBOT_TENANT_ENV]: "1", COMMS_FAKE_PROVIDER: "1" };
}

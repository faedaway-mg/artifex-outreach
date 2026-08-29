// ─────────────────────────────────────────────────────────────────────────────
// Provider signer configuration (Gate 2). The PROVIDER (Artifex) legal identity + signer
// name/email come ONLY from server-side environment — never from browser input. Production
// send fails closed when any value is absent/malformed. The rehearsal Gmail alias is never
// hard-coded here.
// ─────────────────────────────────────────────────────────────────────────────
import { isValidEmailSyntax, isPlusAlias, normalizeEmail } from "../billing/recipient-policy";

export const PROVIDER_ENV = {
  legalName: "AGREEMENT_PROVIDER_LEGAL_NAME",
  signerName: "AGREEMENT_PROVIDER_SIGNER_NAME",
  signerEmail: "AGREEMENT_PROVIDER_SIGNER_EMAIL",
} as const;

/** The expected contracting entity (recipient-facing; not a secret). */
export const EXPECTED_PROVIDER_LEGAL_NAME = "Artifex Labs Systems LLC d/b/a Artifex Labs";

export interface ProviderSignerConfig {
  legalName: string;
  signerName: string;
  signerEmail: string;
}

export interface ProviderConfigResult {
  ok: boolean;
  config?: ProviderSignerConfig;
  issues: string[];
}

/**
 * Resolve provider signer config from the environment. `forProduction` applies the
 * stricter rules (no plus-alias, all fields present, entity matches expected). In test
 * mode the config is optional (the rehearsal uses per-call aliases).
 */
export function resolveProviderSignerConfig(env: NodeJS.ProcessEnv = process.env, forProduction = true): ProviderConfigResult {
  const legalName = (env[PROVIDER_ENV.legalName] ?? "").trim();
  const signerName = (env[PROVIDER_ENV.signerName] ?? "").trim();
  const signerEmail = normalizeEmail(env[PROVIDER_ENV.signerEmail] ?? "");
  const issues: string[] = [];

  if (!forProduction) {
    // Test mode: only used if fully present; otherwise the caller supplies per-call values.
    if (legalName && signerName && isValidEmailSyntax(signerEmail)) {
      return { ok: true, config: { legalName, signerName, signerEmail }, issues };
    }
    return { ok: false, issues: ["provider config not fully set (test mode uses per-call values)"] };
  }

  if (!legalName) issues.push(`${PROVIDER_ENV.legalName} is not set`);
  if (!signerName) issues.push(`${PROVIDER_ENV.signerName} is not set`);
  if (!signerEmail) issues.push(`${PROVIDER_ENV.signerEmail} is not set`);
  if (signerEmail && !isValidEmailSyntax(signerEmail)) issues.push(`${PROVIDER_ENV.signerEmail} is not a valid email`);
  if (signerEmail && isPlusAlias(signerEmail)) issues.push(`${PROVIDER_ENV.signerEmail} is a plus-alias (prohibited for a production provider)`);
  if (legalName && legalName !== EXPECTED_PROVIDER_LEGAL_NAME) {
    issues.push(`${PROVIDER_ENV.legalName} ('${legalName}') does not match the expected provider legal entity`);
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, config: { legalName, signerName, signerEmail }, issues };
}

export class ProviderConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Provider signer configuration invalid: ${issues.join("; ")}`);
    this.name = "ProviderConfigError";
    this.issues = issues;
  }
}

/** Throw unless production provider config is present + valid. */
export function assertProviderConfigForProduction(env: NodeJS.ProcessEnv = process.env): ProviderSignerConfig {
  const r = resolveProviderSignerConfig(env, true);
  if (!r.ok || !r.config) throw new ProviderConfigError(r.issues);
  return r.config;
}

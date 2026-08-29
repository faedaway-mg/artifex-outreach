// ─────────────────────────────────────────────────────────────────────────────
// Production recipient policy (Gate 5). PURE — no I/O. Decides whether a set of
// signing recipients is acceptable for a PRODUCTION (legally-binding) agreement.
//
// The rehearsal deliberately used a Gmail "+alias" so one person could sign both
// roles. That is exactly what must be IMPOSSIBLE in production: a real agreement must
// go to a real, verified, distinct client — never an owner-controlled alias, an
// internal Artifex address, a rehearsal recipient, or a test/example domain.
//
// This module never tries to prove legal identity from an email; it enforces
// structural safety and defers identity to the operator's verified client record
// (the caller passes `clientEmailVerified` + `clientRecordEmail`).
// ─────────────────────────────────────────────────────────────────────────────

export type EsignMode = "test" | "production";

export interface RecipientInput {
  /** Provider signer email — MUST come from server-side config in production. */
  providerEmail: string;
  providerFromServerConfig: boolean;
  /** Client signer email — the actual, verified client contact in production. */
  clientEmail: string;
  /** True only if the operator's client record marks this email verified. */
  clientEmailVerified: boolean;
  /** The email on the bound client record; the client signer must equal it. */
  clientRecordEmail: string | null;
  /** Emails known to be operator/internal (owner inbox, operator session email). */
  operatorEmails?: string[];
  /** COMMS_TEST_RECIPIENT and any other configured rehearsal recipients. */
  knownTestRecipients?: string[];
}

export interface RecipientCheck {
  ok: boolean;
  issues: string[];
}

/** Lower-case + trim. Does NOT strip +tags (a +tag is a DISTINCT, rejectable address). */
export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/** Gmail-style plus alias: a "+" in the local part. */
export function isPlusAlias(email: string): boolean {
  const local = normalizeEmail(email).split("@")[0] ?? "";
  return local.includes("+");
}

const INTERNAL_DOMAINS = ["artifexlabs.tech", "artifex.labs", "artifexlabs.com", "faedaway.com"];
const TEST_DOMAINS = ["example.com", "example.org", "example.net", "test.com", "signwell.example"];
const TEST_TLDS = [".test", ".example", ".invalid", ".localhost"];
const DISPOSABLE_DOMAINS = ["mailinator.com", "guerrillamail.com", "10minutemail.com", "trashmail.com", "yopmail.com"];

function domainOf(email: string): string {
  return normalizeEmail(email).split("@")[1] ?? "";
}

/** RFC-lite but strict enough: exactly one @, non-empty local + domain, a dotted TLD. */
export function isValidEmailSyntax(email: string): boolean {
  const e = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !e.includes("..");
}

function isInternalDomain(email: string): boolean {
  return INTERNAL_DOMAINS.includes(domainOf(email));
}
function isTestDomain(email: string): boolean {
  const d = domainOf(email);
  return TEST_DOMAINS.includes(d) || TEST_TLDS.some((t) => d.endsWith(t));
}
function isDisposableDomain(email: string): boolean {
  return DISPOSABLE_DOMAINS.includes(domainOf(email));
}

/**
 * Validate recipients for a PRODUCTION agreement. Returns every failing reason
 * (not just the first) so the operator sees the full picture. Fails closed.
 */
export function validateProductionRecipients(input: RecipientInput): RecipientCheck {
  const issues: string[] = [];
  const provider = normalizeEmail(input.providerEmail);
  const client = normalizeEmail(input.clientEmail);
  const operators = (input.operatorEmails ?? []).map(normalizeEmail);
  const testRecips = (input.knownTestRecipients ?? []).map(normalizeEmail).filter(Boolean);

  // Syntax.
  if (!isValidEmailSyntax(provider)) issues.push("provider email is not valid syntax");
  if (!isValidEmailSyntax(client)) issues.push("client email is not valid syntax");

  // Provider must come from server config, and never be an alias/test address.
  if (!input.providerFromServerConfig) issues.push("provider email must come from server-side configuration, not a request argument");
  if (isPlusAlias(provider)) issues.push("provider email is a plus-alias (prohibited in production)");

  // Client must be real, verified, distinct, and NOT owner/internal/test/alias.
  if (isPlusAlias(client)) issues.push("client email is a plus-alias (prohibited in production)");
  if (isInternalDomain(client)) issues.push("client email is an internal Artifex address (cannot be the client in production)");
  if (isTestDomain(client)) issues.push("client email uses a test/example domain");
  if (isDisposableDomain(client)) issues.push("client email uses a disposable domain");
  if (operators.includes(client)) issues.push("client email is an operator/internal address (operator cannot be substituted for the client)");
  if (testRecips.includes(client)) issues.push("client email is a known rehearsal/test recipient");
  if (!input.clientEmailVerified) issues.push("client email is not verified on the client record");
  if (input.clientRecordEmail != null && normalizeEmail(input.clientRecordEmail) !== client) {
    issues.push("client signer email does not match the bound client record");
  }
  if (input.clientRecordEmail == null) issues.push("no bound client record email to verify the client signer against");

  // Distinct provider vs client — normalized (case-insensitive) inequality.
  if (provider && client && provider === client) issues.push("provider and client addresses must be distinct");

  return { ok: issues.length === 0, issues };
}

/**
 * TEST-mode recipients: owner-controlled aliases ARE allowed (that's the rehearsal),
 * but they must be visibly test and can NEVER unlock production billing (enforced by
 * the firewall, not here). We only require distinctness + basic syntax so a two-signer
 * test document can be created.
 */
export function validateTestRecipients(input: Pick<RecipientInput, "providerEmail" | "clientEmail">): RecipientCheck {
  const issues: string[] = [];
  const provider = normalizeEmail(input.providerEmail);
  const client = normalizeEmail(input.clientEmail);
  if (!isValidEmailSyntax(provider)) issues.push("provider email is not valid syntax");
  if (!isValidEmailSyntax(client)) issues.push("client email is not valid syntax");
  if (provider && client && provider === client) issues.push("provider and client addresses must be distinct (SignWell rejects duplicates)");
  return { ok: issues.length === 0, issues };
}
